define (['../util/binarysearch', '../util/interval', '../util/eventify'],
    function (BinarySearch, Interval, eventify) {

    'use strict';

    const Relation = Interval.Relation;

    /*
        UTILITY
    */

    function isIterable(obj) {
        // checks for null and undefined
        if (obj == null) {
            return false;
        }
        return typeof obj[Symbol.iterator] === 'function';
    }

    /*
        concat two arrays without creating a copy
        push elements from the shortest into the longest
        return the longest
        - does not preserve ordering
    */
    const mergeArrays = function(arr1, arr2) {
        const [shortest, longest] = (arr1.length <= arr2.length) ? [arr1, arr2] : [arr2, arr1];
        let len = shortest.length;
        for (let i=0; i<len; i++) {
            longest.push(shortest[i]);
        }
        return longest;
    };

    /*
        object equals
    */
    function object_equals(a, b) {
        // Create arrays of property names
        var aProps = Object.getOwnPropertyNames(a);
        var bProps = Object.getOwnPropertyNames(b);

        // If number of properties is different,
        // objects are not equivalent
        if (aProps.length != bProps.length) {
            return false;
        }

        for (var i = 0; i < aProps.length; i++) {
            var propName = aProps[i];

            // If values of same property are not equal,
            // objects are not equivalent
            if (a[propName] !== b[propName]) {
                return false;
            }
        }

        // If we made it this far, objects
        // are considered equivalent
        return true;
    }




    /*
        Add cue to array
        - does not add if cue already exists
        - returns array length
    */
    var addCueToArray = function (arr, cue) {
        // cue equality defined by key property
        if (arr.length == 0) {
            arr.push(cue);
        } else {
            let idx = arr.findIndex(function (_cue) {
                return _cue.key == cue.key;
            });
            if (idx == -1) {
                arr.push(cue);
            }
        }
        return arr.length;
    };

    /*
        Remove cue from array
        - noop if cue does not exist
        - returns array length
    */
    var removeCueFromArray = function (arr, cue) {
        // cue equality defined by key property
        if (arr.length == 0) {
            return true;
        } else {
            let idx = arr.findIndex(function (_cue) {
                return _cue.key == cue.key;
            });
            if (idx > -1) {
                arr.splice(idx, 1);
            }
            return arr.length == 0;
        }
    };

    /*
        Setup ID's for cue buckets.
    */
    const CueBucketIds = [0, 10, 100, 1000, 10000, 100000, Infinity];
    var getCueBucketId = function (length) {
        for (let i=0; i<CueBucketIds.length; i++) {
            if (length <= CueBucketIds[i]) {
                return CueBucketIds[i];
            }
        }
    };

    /*
        Semantic

        Specifies the semantic for cue operations

        INSIDE  - all cues with both endpoints INSIDE the search interval
        PARTIAL - all INSIDE cues, plus cues that PARTIALL overlap search interval, i.e. have only one endpoint INSIDE search interval
        OVERLAP - all PARTIAL cues, plus cues that fully OVERLAP search interval, but have no endpoints INSIDE search interval

    */
    const Semantic = Object.freeze({
        INSIDE: "inside",
        PARTIAL: "partial",
        OVERLAP: "overlap"
    });

    /*
        Method

        Specifies various methods on CueBuckets

        LOOKUP_CUEPOINTS - look up all (point, cue) tuples in search interval
        LOOKUP_CUES - lookup all cues in interval
        REMOVE_CUES - remove all cues in interval

    */
    const Method = Object.freeze({
        LOOKUP_CUES: "lookup-cues",
        LOOKUP_CUEPOINTS: "lookup-cuepoints",
        REMOVE_CUES: "remove-cues",
        INTEGRITY: "integrity",
        LOOKUP_POINTS: 1,
        LOOKUP: 2
    });

    /*
        Delta

        Used to represent statechanges in batchMap,
        for intervals and data.
    */

    const Delta = Object.freeze({
        NOOP: 0,
        INSERT: 1,
        REPLACE: 2,
        DELETE: 3
    });


    /*
        make a shallow copy of a cue
    */
    function cue_copy(cue) {
        if (cue == undefined) {
            return;
        }
        return {
            key: cue.key,
            interval: cue.interval,
            data: cue.data
        };
    }

    /*
        Characterize the transition from cue_a to cue_b
        in terms of delta values for interval and data

        For instance, interval has
        - INSERT: value not in a but in b
        - DELETE: value in a but not in b
        - REPLACE: value in a and in be and not equal
        - NOOP: either remains undefined or remains equal

        optional equals function for data comparison
        otherwise simple object equality (==) is used
    */
    function cue_delta(cue_a, cue_b, equals) {
        let interval_delta, data_delta, eq;
        // interval delta
        let a_interval_defined = cue_a != undefined && cue_a.interval != undefined;
        let b_interval_defined = cue_b != undefined && cue_b.interval != undefined;
        if (!a_interval_defined && !b_interval_defined) {
            interval_delta = Delta.NOOP;
        } else if (!a_interval_defined) {
            interval_delta = Delta.INSERT;
        } else if (!b_interval_defined) {
            interval_delta = Delta.DELETE;
        } else {
            // check interval equality
            eq = cue_a.interval.equals(cue_b.interval);
            interval_delta = (eq) ? Delta.NOOP : Delta.REPLACE;
        }
        // data delta
        let a_data_defined = cue_a != undefined && cue_a.data != undefined;
        let b_data_defined = cue_b != undefined && cue_b.data != undefined;
        if (!a_data_defined && !b_data_defined) {
            data_delta = Delta.NOOP;
        } else if (!a_data_defined) {
            data_delta = Delta.INSERT;
        } else if (!b_data_defined) {
            data_delta = Delta.DELETE;
        } else {
            // check data equality
            if (equals) {
                eq = equals(cue_a.data, cue_b.data);
            } else {
                eq = (cue_a.data == cue_b.data);
            }
            data_delta = (eq) ? Delta.NOOP : Delta.REPLACE;
        }
        return {interval: interval_delta, data: data_delta};
    }


    /*
        determine equality for two cues
        <equals> is optional equality function for cue.data
        if not specified simple value equality (==) is used
    */
    function cue_equals(cue_a, cue_b, equals) {
        let delta = cue_delta(cue_a, cue_b, equals);
        return delta.interval == Delta.NOOP && delta.data == Delta.NOOP;
    }


    /*
        this implements Axis, a datastructure for efficient lookup of
        cues on a timeline

        - cues may be tied to one or two points on the timeline, this
          is expressed by an Interval.
        - cues are indexed both by key and by intervals
        - the timeline index is divided into a set of CueBuckets,
          based on cue interval length, for efficient lookup
    */

    class Axis {


        constructor() {
            /*
                efficient lookup of cues by key
                key -> cue
            */
            this._cueMap = new Map();

            /*
                Initialise set of CueBuckets
                Each CueBucket is responsible for cues of a certain length
            */
            this._cueBuckets = new Map();  // CueBucketId -> CueBucket
            for (let i=0; i<CueBucketIds.length; i++) {
                let cueBucketId = CueBucketIds[i];
                this._cueBuckets.set(cueBucketId, new CueBucket(cueBucketId));
            }

            // Change event
            eventify.eventifyInstance(this, {init:false});
            this.eventifyDefineEvent("change", {init:false});
        };


        /*
            SIZE
            Number of cues managed by axis
        */
        get size () {
            return this._cueMap.size;
        }


        /***************************************************************
            UPDATE

            - insert, replace or delete cues

            update(cues, equals, check)

            <cues> ordered list of cues to be updated
            <equals> - equality function for data objects
            <check> - check cue integrity if true

            cue = {
                key:key,
                interval: Interval,
                data: data
            }

            required
            - cue.key property is defined and value is != undefined
            - if cue.interval != undefined, it must be instance of Interval

            EXAMPLES

            // INSERT (no pre-existing cue)

            cue = {key:1, interval: new Interval(3,4), data: {}}
            // insert cue with only interval
            cue = {key:1, interval: new Interval(3,4)}
            // insert cue with only data
            cue = {key:1, data: {}}


            // REPLACE (pre-existing cue)
            preexisting_cue = {key:1, interval: new Interval(3,4), data: {}}

            cue = {key:1, interval: new Interval(3,5), data: {foo:"bar"}}
            // replace interval, keep data
            cue = {key:1, interval: new Interval(3,5)}
            // replace interval, delete data
            cue = {key:1, interval: new Interval(3,5), data: undefined
            // replace data, keep interval
            cue = {key:1, data: {foo:"bar"}}
            // replace data, delete interval
            cue = {key:1, interval: undefined, data: {foo:"bar"}}

            // DELETE (pre-existing)
            cue = {key:1}
            // delete interval, keep data
            cue = {key:1, interval: undefined}
            // delete data, keep interval
            cue = {key:1, data: undefined}


            Update returns a batchMap - describes the effects of an update.
                batchMap is a Map() object
                key -> {
                    new: new_cue,
                    old: old_cue,
                    delta: {
                        interval: Delta,
                        data: Delta
                    }
                }

            with independent delta values for interval and data:
            Delta.NOOP: 0
            Delta.INSERT: 1
            Delta.REPLACE: 2
            Delta.DELETE: 3

            Duplicates
            - if there are multiple cue operations for the same key,
              within the same batch of cues,
              these will be processed in order.

            - The old cue will always be the state of the cue,
              before the batch started.

            - The returned delta values will be calcultated relative to
              the cue before the batch started (old).

              This way, external mirroring observers may will be able to
              replicate the effects of the update operation.

        ***************************************************************/

        update(cues, options) {
            const batchMap = new Map();
            let len, cue, current_cue;
            let has_interval, has_data;
            let init = this._cueMap.size == 0;
            // options
            options = options || {};
            // check is false by default
            if (options.check == undefined) {
                options.check = false;
            }
            if (!Array.isArray(cues)) {
                cues = [cues];
            }

            /***********************************************************
                process all cues
            ***********************************************************/
            len = cues.length;
            for (let i=0; i<len; i++) {
                cue = cues[i];

                /*******************************************************
                    check validity of cue argument
                *******************************************************/

                if (options.check) {
                    if (!(cue) || !cue.hasOwnProperty("key") || cue.key == undefined) {
                        throw new Error("illegal cue", cue);
                    }
                }
                has_interval = cue.hasOwnProperty("interval");
                has_data = cue.hasOwnProperty("data");
                if (options.check && has_interval) {
                    if (!cue.interval instanceof Interval) {
                        throw new Error("interval must be Interval");
                    }
                }

                /*******************************************************
                    adjust cue so that it correctly represents
                    the new cue to replace the current cue
                    - includeds preservation of values from current cue
                *******************************************************/

                current_cue = (init) ? undefined : this._cueMap.get(cue.key);
                if (current_cue == undefined) {
                    // make sure properties are defined
                    if (!has_interval) {
                        cue.interval = undefined;
                    }
                    if (!has_data) {
                        cue.data = undefined;
                    }
                } else if (current_cue != undefined) {
                    if (!has_interval && !has_data) {
                        // make sure properties are defined
                        cue.interval = undefined;
                        cue.data = undefined;
                    } else if (!has_data) {
                        // REPLACE_INTERVAL, preserve data
                        cue.data = current_cue.data;
                    } else if (!has_interval) {
                        // REPLACE_DATA, preserve interval
                        cue.interval = current_cue.interval;
                    } else {
                        // REPLACE CUE
                    }
                }

                /*******************************************************
                    update cue
                    - update cueMap
                    - update cueBuckets
                    - create batchMap
                *******************************************************/

                this._update_cue(batchMap, current_cue, cue, options.equals);
            }
            if (batchMap.size > 0) {
                // flush all buckets so updates take effect
                for (let cueBucket of this._cueBuckets.values()) {
                    cueBucket.flush();
                }
                // event notification
                this.eventifyTriggerEvent("change", batchMap);
            }
            return batchMap;
        };



        /***************************************************************
            UPDATE CUE

            update operation for a single cue

            - update cueMap
            - generate entry for batchMap
            - update CueBucket
        ***************************************************************/

        _update_cue(batchMap, current_cue, cue, equals) {
            let old_cue, new_cue;
            let item, _item;
            let oldCueBucket, newCueBucket;
            let low_changed, high_changed;
            let remove_needed, add_needed;

            // check for equality
            let delta = cue_delta(current_cue, cue, equals);

            // ignore (NOOP, NOOP)
            if (delta.interval == Delta.NOOP && delta.data == Delta.NOOP) {
                item = {new:current_cue, old:current_cue, delta:delta};
                batchMap.set(cue.key, item);
                return;
            }

            /***********************************************************
                update cueMap and batchMap
            ***********************************************************/

            if (current_cue == undefined) {
                // INSERT - add cue object to cueMap
                old_cue = undefined;
                new_cue = cue;
                this._cueMap.set(cue.key, new_cue);
            } else if (cue.interval == undefined && cue.data == undefined) {
                // DELETE - remove cue object from cueMap
                old_cue = current_cue;
                new_cue = undefined;
                this._cueMap.delete(cue.key);
            } else {
                // REPLACE
                // in-place modification of current cue
                // copy old cue before modification
                old_cue = cue_copy(current_cue);
                new_cue = current_cue;
                // update current cue in place
                new_cue.interval = cue.interval;
                new_cue.data = cue.data;
            }
            item = {new:new_cue, old:old_cue, delta:delta};

            /*
                if this item has been set earlier in batchMap
                restore the correct old_cue by getting it from
                the previous batchMap item
                also recalculate delta relative to old_cue
            */

            _item = batchMap.get(cue.key);
            if (_item != undefined) {
                item.old = _item.old;
                item.delta = cue_delta(item.old, item.new);
            }
            batchMap.set(cue.key, item)

            /***********************************************************
                update cueBuckets

                - use delta.interval to avoid unnessesary changes

                - interval may change in several ways:
                    - low changed
                    - high changed
                    - low and high changed
                - intervals may also go from
                    - singular -> singular
                    - singular -> regular
                    - regular -> singular
                    - regular -> regular
                - changes to interval.lowInclude and interval highInclude
                  do not require any changes to CueBuckets, as long
                  as interval.low and interval.high values stay unchanged.
            ***********************************************************/

            if (delta.interval == Delta.NOOP) {
                // data changes are reflected in cueMap changes,
                // since data changes are made in-place, these
                // changes will be visible in cues registered in
                // CueBuckets
                return;
            } else if (delta.interval == Delta.INSERT) {
                remove_needed = false;
                add_needed = true;
                low_changed = true;
                high_changed = true;
            } else if (delta.interval == Delta.DELETE) {
                remove_needed = true;
                add_needed = false;
                low_changed = true;
                high_changed = true;
            } else if (delta.interval == Delta.REPLACE) {
                remove_needed = true;
                add_needed = true;
                low_changed = item.new.interval.low != item.old.interval.low;
                high_changed = item.new.interval.high != item.old.interval.high;
            }

            /*
                old cue and new cue might not belong to the same cue bucket
            */
            if (remove_needed) {
                let bid = getCueBucketId(item.old.interval.length);
                oldCueBucket = this._cueBuckets.get(bid);
            }
            if (add_needed) {
                let bid = getCueBucketId(item.new.interval.length);
                newCueBucket = this._cueBuckets.get(bid);
            }

            /*
                dispatch add and remove operations for interval points

                cues in CueBucket may be removed using a copy of the cue,
                because remove is by key.

                cues added to CueBucket must be the correct object
                (current_cue), so that later in-place modifications become
                reflected in CueBucket.
                batchMap item.new is the current cue object.
            */

            // update low point - if changed
            if (low_changed) {
                if (remove_needed) {
                    // console.log("remove old low", item.old.interval.low);
                    oldCueBucket.processCue("remove", item.old.interval.low, item.old);
                }
                if (add_needed) {
                    // console.log("add new low", item.new.interval.low);
                    newCueBucket.processCue("add", item.new.interval.low, item.new);
                }
            }
            // update high point - if changed
            if (high_changed) {
                if (remove_needed && !item.old.interval.singular) {
                    // console.log("remove old high", item.old.interval.high);
                    oldCueBucket.processCue("remove", item.old.interval.high, item.old);
                }
                if (add_needed && !item.new.interval.singular) {
                    // console.log("add new high", item.new.interval.high);
                    newCueBucket.processCue("add", item.new.interval.high, item.new);
                }
            }
        }


        /*
            INTERNAL FUNCTION
            execute method across all cue buckets
            and aggregate results
        */
        _execute(method, interval, arg) {
            const res = [];
            for (let cueBucket of this._cueBuckets.values()) {
                let cues = cueBucket.execute(method, interval, arg);
                if (cues.length > 0) {
                    res.push(cues);
                }
            }
            return [].concat(...res);
        };

        /*
            GET CUEPOINTS BY INTERVAL

            returns (point, cue) for all points covered by given interval

            returns:
                - list of cuepoints, from cue endpoints within interval
                - [{point: point, cue:cue}]
        */
        getCuePointsByInterval(interval) {
            return this._execute(Method.LOOKUP_CUEPOINTS, interval);
        };

        lookup_points(interval) {
            return this._execute(Method.LOOKUP_POINTS, interval);
        }


        /*
            GET CUES BY INTERVAL

            semantic - "inside" | "partial" | "overlap"

        */
        getCuesByInterval(interval, semantic=Semantic.OVERLAP) {
            return this._execute(Method.LOOKUP_CUES, interval, semantic);
        };

        lookup(interval, mode) {
            // check mode
            if (!mode) {
                // default mode
                mode = [
                    Relation.OVERLAP_LEFT,
                    Relation.COVERED,
                    Relation.EQUALS,
                    Relation.COVERS,
                    Relation.OVERLAP_RIGHT
                ];
            } else {
                if (!Array.isArray(mode)) {
                    throw new Error("mode must Array of integers, or undefined", mode);
                }
            }
            return this._execute(Method.LOOKUP, interval, mode);
        }


        /*
            REMOVE CUES BY INTERVAL
        */
        removeCuesByInterval(interval, semantic=Semantic.INSIDE) {
            const cues = this._execute(Method.REMOVE_CUES, interval, semantic);
            // remove from cueMap and make events
            const eventMap = new Map();
            for (let i=0; i<cues.length; i++) {
                let cue = cues[i];
                this._cueMap.delete(cue.key);
                eventMap.set(cue.key, {'old': cue});
            }
            this.eventifyTriggerEvent("change", eventMap);
            return eventMap;
        };

        /*
            CLEAR ALL CUES
        */
        clear() {
            // clear cue Buckets
            for (let cueBucket of this._cueBuckets.values()) {
                cueBucket.clear();
            }
            // clear cueMap
            let cueMap = this._cueMap;
            this._cueMap = new Map();
            // create change events for all cues
            let e = [];
            for (let cue of cueMap.values()) {
                e.push({'old': cue});
            }
            this.eventifyTriggerEvent("change", e);
            return cueMap;
        };


        /*
            Accessors
        */

        has(key) {
            return this._cueMap.has(key);
        };

        get(key) {
            return this._cueMap.get(key);
        };

        keys() {
            return [...this._cueMap.keys()];
        };

        cues() {
            return [...this._cueMap.values()];
        };


        /*
            utility
        */
        _integrity() {
            const res = this._execute(Method.INTEGRITY);

            // sum up cues and points
            let cues = [];
            let points = [];
            for (let bucketInfo of res.values()) {
                cues.push(bucketInfo.cues);
                points.push(bucketInfo.points);
            }
            cues = [].concat(...cues);
            points = [].concat(...points);
            // remove point duplicates if any
            points = [...new Set(points)];

            if (cues.length != this._cueMap.size) {
                throw new Error("inconsistent cue count cueMap and aggregate cueBuckets " + cues-this._cueMap.size);
            }

            // check that cues are the same
            for (let cue of cues.values()) {
                if (!this._cueMap.has(cue.key)) {
                    throw new Error("inconsistent cues cueMap and aggregate cueBuckets");
                }
            }

            return {
                cues: cues.length,
                points: points.length
            };
        };

    }


    eventify.eventifyPrototype(Axis.prototype);




    /*
        CueBucket is a bucket of cues limited to specific length
    */


    class CueBucket {


        constructor(maxLength) {

            // max length of cues in this bucket
            this._maxLength = maxLength;

            /*
                pointMap maintains the associations between values (points on
                the timeline) and cues that reference such points. A single point value may be
                referenced by multiple cues, so one point value maps to a list of cues.

                value -> [cue, ....]
            */
            this._pointMap = new Map();


            /*
                pointIndex maintains a sorted list of numbers for efficient lookup.
                A large volume of insert and remove operations may be problematic
                with respect to performance, so the implementation seeks to
                do a single bulk update on this structure, for each batch of cue
                operations (i.e. each invocations of addCues). In order to do this
                all cue operations are processed to calculate a single batch
                of deletes and a single batch of inserts which then will be applied to
                the pointIndex in one atomic operation.

                [1.2, 3, 4, 8.1, ....]
            */
            this._pointIndex = new BinarySearch();

            // bookeeping during batch processing
            this._created = new Set(); // point
            this._dirty = new Set(); // point


            // method map
            this._methodMap = new Map([
                [Method.LOOKUP_REMOVE, this.lookup_remove.bind(this)],
                [Method.LOOKUP, this.lookup.bind(this)],
                [Method.LOOKUP_POINTS, this.lookup_points.bind(this)],
                [Method.INTEGRITY, this._integrity.bind(this)]
            ]);

        };


        /*

            CUE BATCH PROCESSING

            Needs to translate cue operations into a minimum set of
            operations on the pointIndex.

            To do this, we need to record points that are created and
            points that are removed.

            The total difference that the batch of cue operations
            amounts to is expressed as one list of values to be
            deleted, and and one list of values to be inserted.
            The update operation of the pointIndex will process both
            in one atomic operation.

            On flush both the pointMap and the pointIndex will be brought
            up to speed

            created and dirty are used for bookeeping during
            processing of a cue batch. They are needed to
            create the correct diff operation to be applied on pointIndex.

            created : includes values that were not in pointMap
            before current batch was processed

            dirty : includes values that were in pointMap
            before current batch was processed, and that
            have been become empty at least at one point during cue
            processing.

            created and dirty are used as temporary alternatives to pointMap.
            after the cue processing, pointmap will updated based on the
            contents of these two.

            operation add or remove for given cue

            this method may be invoked at most two times for the same key.
            - first "remove" on the old cue
            - second "add" on the new cue

            "add" means cue to be added to point
            "remove" means cue to be removed from point

            process buffers operations for pointMap and index so that
            all operations may be applied in one batch. This happens in flush
        */

        processCue(op, point, cue) {
            let init = (this._pointMap.size == 0);
            let cues = (init) ? undefined : this._pointMap.get(point);
            if (cues == undefined) {
                cues = [];
                this._pointMap.set(point, cues);
                this._created.add(point);
            }
            if (op == "add") {
                addCueToArray(cues, cue);
            } else {
                let empty = removeCueFromArray(cues, cue);
                if (empty) {
                    this._dirty.add(point);
                }
            }
        };

        /*
            Batch processing is completed
            Commit changes to pointIndex and pointMap.

            pointMap
            - update with contents of created

            pointIndex
            - points to delete - dirty and empty
            - points to insert - created and non-empty
        */
        flush() {
            if (this._created.size == 0 && this._dirty.size == 0) {
                return;
            }

            // update pointIndex
            let to_remove = [];
            let to_insert = [];
            for (let point of this._created.values()) {
                let cues = this._pointMap.get(point);
                if (cues.length > 0) {
                    to_insert.push(point);
                } else {
                    this._pointMap.delete(point);
                }
            }
            for (let point of this._dirty.values()) {
                let cues = this._pointMap.get(point);
                if (cues.length == 0) {
                    to_remove.push(point);
                    this._pointMap.delete(point);
                }
            }
            this._pointIndex.update(to_remove, to_insert);
            // cleanup
            this._created.clear();
            this._dirty.clear();
        };


        /*
            execute dispatches request to given method on CueBatch.
        */
        execute(method, interval, arg) {
            if (this._pointIndex.length == 0) {
                return [];
            }
            let func = this._methodMap.get(method);
            if (func) {
                return func(interval, arg);
            } else {
                throw new Error("method not supported " + method);
            }
        };


        /*
            LOOKUP_POINTS

            returns all (point, cue) pairs where
                - point is a cue endpoint (cue.low or cue.high)
                - at least one cue endpoint is INSIDE search interval
                - [{point:point, cue: cue}]

            - a given point may appear multiple times in the result,
              as multiple cues may be tied to the same cue
            - a given cue may appear two times in the result, if
              both cue.low and cue.high are both INSIDE interval
            - a singular cue will appear only once
            - ordering: no specific order is guaranteed
              - results are concatenated from multiple CueBuckets
              - internally in a single CueBucket
                - points will be ordered ascending
                - no defined order for cues tied to the same point
              - the natural order is endpoint order
                - but this can be added on the outside if needed
                - no order is defined if two cues have exactly the
                  same endpoint

        */

        lookup_points(interval) {
            const broader_interval = new Interval(interval.low, interval.high, true, true);
            const points = this._pointIndex.lookup(broader_interval);
            const result = [];
            const len = points.length;
            let low_inside, high_inside;
            for (let i=0; i<len; i++) {
                point = points[i];
                this._pointMap.get(point)
                    forEach(function (cue) {
                        /*
                            keep only cues that have at least one
                            cue endpoint inside the search interval
                            (as defined by endpoint ordering)

                            there are two reasons why such cues might appear
                            - the broadening of the search interval
                            - insensitivity to endpoint ordering in pointIndex
                        */
                        low_inside = interval.inside(cue.interval.endpointLow);
                        high_inside = interval.inside(cue.interval.endpointHigh);
                        if (low_inside || high_inside) {
                            result.push({point:point, cue:cue});
                        }
                    });
            }
            return result;
        }


        /*
            _LOOKUP CUES

            Internal function, used by LOOKUP.

            Return list of cues
            - all cues inside an interval, i.e. cues that
              have at least one endpoint INSIDE interval.
            - no duplicates
        */

        _lookup_cues(interval) {
            const broader_interval = new Interval(interval.low, interval.high, true, true);
            const points = this._pointIndex.lookup(broader_interval);
            const len = points.length;
            const cueSet = new Set();
            const result = [];
            let low_inside, high_inside;
            for (let i=0; i<len; i++) {
                this._pointMap.get(points[i])
                    .forEach(function(cue) {
                        // avoid duplicates
                        if (cueSet.has(cue.key)) {
                            return;
                        } else {
                            cueSet.add(cue.key);
                        }
                        /*
                            keep only cues that have at least one
                            cue endpoint inside the search interval
                            (as defined by endpoint ordering)

                            there are two reasons why such cues might appear
                            - the broadening of the search interval
                            - insensitivity to endpoint ordering in pointIndex
                        */
                        low_inside = interval.inside(cue.interval.endpointLow);
                        high_inside = interval.inside(cue.interval.endpointHigh);
                        if (low_inside || high_inside) {
                            result.push(cue);
                        }
                    });
            }
            return result;
        }



        /*
            LOOKUP

            Strategy split task into two subtasks,

            1) find cues [OVERLAP_LEFT, COVERED, EQUALS, OVERLAP_RIGHT]
            2) find cues [COVERS]


        */
        lookup(interval, mode) {
            let Relation = Interval.Relation;
            let cues = [];


            // special case only [EQUALS]
            let only_equals_needed = (mode.length == 1 && mode[0] == Relation.EQUALS)
            if (only_equals_needed) {
                return this._pointMap.get(interval.low).filter(function(cue) {
                    return cue.interval.equals(interval)
                });
            }

            // common case: [OVERLAP_LEFT, COVERED, EQUALS, OVERLAP_RIGHT]
            // exclude [COVERS]
            // check which lookup types are needed
            let basic = [
                mode.includes(Relation.OVERLAP_LEFT),
                mode.includes(Relation.COVERED),
                mode.includes(Relation.EQUALS),
                mode.includes(Relation.OVERLAP_RIGHT)
            ];
            let any_basic_needed = basic.some((e) => e == true);
            if (any_basic_needed) {
                // keep cues which match lookup mode,
                // except COVERS, which is excluded here
                cues = this._lookup_cues(interval)
                    .filter(function(cue){
                        let relation = cue.interval.compare(interval);
                        // exclude COVERS
                        if (relation == Relation.COVERS) {
                            return false;
                        }
                        return mode.includes(relation);
                    });
            }

            /*
                intervals in this CueBucket are limited by maxLength
                if interval.length is larger than maxLength, no cue
                in this CueBucket can cover interval
            */
            if (interval.length > this._maxLength) {
                return cues;
            }
            if (!mode.includes(Relation.COVERS)) {
                return cues;
            }

            /*
                special handling [COVERS]

                search left of search interval for cues
                that covers the search interval
                search left is limited by CueBucket maxlength
                left_interval: [interval.high-maxLength, interval.low]

                it would be possible to search right too, but we
                have to choose one.
            */
            let low = interval.high - this._maxLength;
            let high = interval.low;
            let left_interval = new Interval(low, high, true, true);
            this._lookup_cues(left_interval)
                .forEach(function(cue){
                    if (cue.interval.compare(interval) == Relation.COVERS) {
                        cues.push(cue);
                    }
                });
            return cues;
        }


        /*
            REMOVE CUES
        */
        lookup_remove(interval, semantic) {
            /*
                update pointMap
                - remove all cues from pointMap
                - remove empty entries in pointMap
                - record points that became empty, as these need to be deleted in pointIndex
                - separate into two bucketes, inside and outside
            */
            const cues = this.execute(Method.LOOKUP_CUES, interval, semantic);
            const to_remove = [];
            let cue, point, points;
            for (let i=0; i<cues.length; i++) {
                cue = cues[i];
                // points of cue
                if (cue.interval.singular) {
                    points = [cue.interval.low];
                } else {
                    points = [cue.interval.low, cue.interval.high];
                }
                for (let j=0; j<points.length; j++) {
                    point = points[j];
                    // remove cue from pointMap
                    // delete pointMap entry only if empty
                    let empty = removeCueFromArray(this._pointMap.get(point), cue);
                    if (empty) {
                        this._pointMap.delete(point);
                        to_remove.push(point);
                    }
                }
            }

            /*
                update pointIndex

                - remove all points within pointIndex
                - exploit locality, the operation is limited to a segment of the index, so
                  the basic idea is to take out a copy of segment (slice), do modifications, and then reinsert (splice)
                - the segment to modify is limited by [interval.low - maxLength, interval.high + maxLenght] as this will cover
                  both cues inside, partial and overlapping.

                # Possible - optimization
                alternative approach using regular update could be more efficient for very samll batches
                this._pointIndex.update(to_remove, []);
                it could also be comparable for huge loads (250.000 cues)
            */

            to_remove.sort(function(a,b){return a-b});
            this._pointIndex.removeInSlice(to_remove);

            /*
                alternative solution
                this._pointIndex.update(to_remove, []);
            */

            return cues;
        };


        /*
            Possible optimization. Implement a removecues method that
            exploits locality by removing an entire slice of pointIndex.
            - this can safely be done for LookupMethod.OVERLAP and PARTIAL.
            - however, for LookupMethod.INSIDE, which is likely the most useful
              only some of the points in pointIndex shall be removed
              solution could be to remove entire slice, construct a new slice
              with those points that should not be deleted, and set it back in.
        */
        clear() {
            this._pointMap = new Map();
            this._pointIndex = new BinarySearch();
        };


        /*
            Integrity test for cue bucket datastructures
            pointMap and pointIndex
        */
        _integrity() {

            if (this._pointMap.size !== this._pointIndex.length) {
                throw new Error("unequal number of points " + (this._pointMap.size - this._pointIndex.length));
            }

            // check that the same cues are present in both pointMap and pointIndex
            const missing = new Set();
            for (let point of this._pointIndex.values()) {
                if (!this._pointMap.has(point)){
                    missing.add(point);
                }
            }
            if (missing.size > 0) {
                throw new Error("differences in points " + [...missing]);
            }

            // collect all cues
            let cues = [];
            for (let _cues of this._pointMap.values()) {
                for (let cue of _cues.values()) {
                    cues.push(cue);
                }
            }
            // remove duplicates
            cues = [...new Map(cues.map(function(cue){
                return [cue.key, cue];
            })).values()];

            // check all cues
            for (let cue of cues.values()) {
                if (cue.interval.length > this._maxLength) {
                    throw new Error("cue interval violates maxLength ",  cue);
                }
                let points;
                if (cue.singular) {
                    points = [cue.interval.low];
                } else {
                    points = [cue.interval.low, cue.interval.high];
                }
                for (let point of points.values()) {
                    if (!this._pointIndex.has(point)) {
                        throw new Error("point from pointMap cue not found in pointIndex ", point);
                    }
                }
            }

            return [{
                maxLength: this._maxLength,
                points: [...this._pointMap.keys()],
                cues: cues
            }];
        };

    }


    // Static variables
    Axis.Delta = Delta;
    Axis.cue_equals = cue_equals;
    Axis.equals = object_equals;
    // module definition
    return Axis;
});
