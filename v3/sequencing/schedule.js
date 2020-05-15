define(function(require) {

    const motionutils = require("../util/motionutils");
    const Interval = require("../util/interval");
    const endpoint = Interval.endpoint;

    const isMoving = motionutils.isMoving;

    const ep2str = Interval.endpoint.toString;

    function queueCmp(a,b) {
        return endpoint.compare(a.tsEndpoint, b.tsEndpoint);
    };

    class Schedule {

        // Default lookahead in seconds
        static LOOKAHEAD = 5

        // Run flags
        static RUN_VECTOR = "vector";
        static RUN_TIMEOUT = "timeout";

        constructor(axis, to, options) {
            // timingobject
            this.to = to;
            // current timeout
            this.tid;
            // current vector
            this.vector;
            // current time interval
            this.timeInterval;
            // current position interval
            this.posInterval;
            // axis
            this.axis = axis;
            // task queue
            this.queue = [];
            // callbacks
            this.callbacks = [];
            // options
            options = options || {};
            options.lookahead = options.lookahead || Schedule.LOOKAHEAD;
            this.options = options;
        }


        /***************************************************************
            CALLBACKS
        ***************************************************************/

        add_callback (handler) {
            let handle = {
                handler: handler
            }
            this.callbacks.push(handle);
            return handle;
        };

        del_callback (handle) {
            let index = this.callbacks.indexof(handle);
            if (index > -1) {
                this.callbacks.splice(index, 1);
            }
        };

        _notify_callbacks (...args) {
            this.callbacks.forEach(function(handle) {
                handle.handler(...args);
            });
        };


        /***************************************************************
            TIMEOUTS
        ***************************************************************/

        /*
            set timeout to point in time (seconds)
        */
        setTimeout(target_ts) {
            if (this.tid != undefined) {
                throw new Error("at most on timeout");
            }
            let now = this.to.clock.now();
            let delay = Math.max(target_ts - now, 0) * 1000;
            this.tid = setTimeout(this.onTimeout.bind(this), delay, target_ts);
        }

        /*
            handle timeout intended for point in time (seconds)
        */
        onTimeout(target_ts) {
            if (this.tid != undefined) {
                this.tid = undefined;
                // check if timeout was too early
                let now = this.to.clock.now()
                if (now < target_ts) {
                    // schedule new timeout
                    this.setTimeout(target_ts);
                } else {
                    // handle timeout
                    this.run(target_ts, Schedule.RUN_TIMEOUT);
                }
            }
        }

        /***************************************************************
            MOTION CHANGE
        ***************************************************************/

        /*
            update schedule with new motion vector
        */
        setVector(vector) {
            let now = vector.timestamp;
            // clean up current motion
            let current_vector = this.vector;
            if (this.vector != undefined) {
                clearTimeout(this.tid);
                this.tid = undefined;
                this.timeInterval = undefined;
                this.posInterval = undefined;
                this.queue = [];
            }
            // update vector
            this.vector = vector;
            // start scheduler if moving
            if (isMoving(this.vector)) {
                this.run(now, Schedule.RUN_VECTOR);
            }
        }


        /***************************************************************
            TASK QUEUE
        ***************************************************************/

        /*
            push eventItem onto queue
        */
        push(eventItems) {
            eventItems.forEach(function(item) {
                if (this.timeInterval.inside(item.tsEndpoint)) {
                    this.queue.push(item);
                } else {
                    console.log("push drop", ep2str(item.tsEndpoint));
                }
            }, this);
            // maintain ordering
            this.queue.sort(queueCmp);
        };

        /*
            pop due eventItems from queue
        */
        pop(now) {
            let eventItem, res = [];
            while (this.queue.length > 0 && endpoint.leftof(this.queue[0].tsEndpoint, now)) {
                res.push(this.queue.shift());
            }
            return res;
        };

        /*
            return timestamp of next eventItem
        */
        next() {
            return (this.queue.length > 0) ? this.queue[0].tsEndpoint[0]: undefined;
        }



        /***************************************************************
            ADVANCE TIMEINTERVAL/POSINTERVAL
        ***************************************************************/

        /*
            advance timeInterval and posInterval if needed
        */
        advance(now) {
            let start, delta = this.options.lookahead;
            let advance = false;
            if (this.timeInterval == undefined) {
                start = now;
                advance = true;
            } else if (endpoint.leftof(this.timeInterval.endpointHigh, now)) {
                start = this.timeInterval.high;
                advance = true
            }
            if (advance) {
                // advance intervals
                this.timeInterval = new Interval(start, start + delta, true, false);
                this.posInterval = motionutils.getPositionInterval(this.timeInterval, this.vector);
                // console.log(`advance pos ${this.posInterval.toString()}`)
                // clear task queue
                this.queue = [];
            }
            return advance;
        }


        /***************************************************************
            LOAD
        ***************************************************************/

        /*
            load events
        */

        load(endpoints, minimum_tsEndpoint) {
            let endpointEvents = motionutils.getEndpointEvents(this.timeInterval,
                                                               this.posInterval,
                                                               this.vector,
                                                               endpoints);
            /*
                ISSUE 1

                Range violation might occur within timeInterval.
                All endpointEvents with .tsEndpoint later or equal to range
                violation will be cancelled.
            */
            let range_ts = motionutils.getRangeIntersect(this.vector, this.to.range)[0];

            /*
                ISSUE 2

                If load is used in response to dynamically added cues, the
                invocation of load might occor at any time during the timeInterval,
                as opposed to immediately after the start of timeInterval.
                This again implies that some of the endPointEvents we have found
                from the entire timeInterval might already be historic at time of
                invocation.

                Cancel endpointEvents with .tsEndpoint < minimum_ts.

                For regular loads this will have no effect since we
                do not specify a minimum_ts, but instead let it assume the
                default value of timeInterval.low.
            */
            if (minimum_tsEndpoint == undefined) {
                minimum_tsEndpoint = this.timeInterval.endpointLow;
            }

            /*
                ISSUE 3

                With acceleration the motion might change direction at
                some point, which might be a cue endpoint. In this
                case, motion touches the cue endpoint but does not actually
                cross over it.

                For simplicity we say that this should not change the
                active state of that cue. The cue is either not activated
                or not inactivated by this occurrence. We might therefor
                simply drop such endpointEvents.

                To detect this, note that velocity will be exactly 0
                evaluated at the cue endpoint, but acceleration will be nonzero.
            */

            return endpointEvents.filter(function(item) {
                // ISSUE 1
                if (range_ts <= item.tsEndpoint[0]) {
                    return false;
                }
                // ISSUE 2
                if (endpoint.leftof(item.tsEndpoint, minimum_tsEndpoint)) {
                    return false;
                }
                // ISSUE 3
                if (this.vector.acceleration != 0.0) {
                    let ts = item.tsEndpoint[0];
                    let v = motionutils.calculateVector(this.vector, ts);
                    if (v.position == item.endpoint[0] && v.velocity == 0) {
                        return false;
                    }
                }
                return true;
            }, this);
        }


        /***************************************************************
            RUN
        ***************************************************************/

        /*
            run schedule
        */
        run(now, run_flag) {
            // process - due events
            let dueEvents = this.pop(now);
            // advance schedule and load events if needed
            if (this.advance(now)) {
                // fetch cue endpoints for posInterval
                let endpoints = this.axis.lookup_endpoints(this.posInterval);
                // load events and push on queue
                this.push(this.load(endpoints));
                // process - possibly new due events
                dueEvents.push(...this.pop(now));
            }
            if (dueEvents.length > 0) {
                this._notify_callbacks(dueEvents, this);
            }
            // timeout - until next due event
            let ts = this.next() || this.timeInterval.high;
            this.setTimeout(Math.min(ts, this.timeInterval.high));
        }
    }

    return Schedule;
});

