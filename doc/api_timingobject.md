---
layout: default
title: Timing Object API
---

This describes the API of the Timing Object, as implemented in the timingsrc library.

#### StateVector

State vectors are used in interactions with the timing object, as parameters and return values. 
Timestamp defines a point in time when values for position, velocity and acceleration were|are|will-be valid. 

```javascript
var vector = {
	position: 12.0,             // position (units) of timing object
	velocity: 1.0,              // velocity (units/second) of timing object
	acceleration : 0.0, 		// acceleration (units/second/second) of timing object
	timestamp : 123652365.234   // timestamp from clock used by timing object (seconds)
};
```


#### Constructor

```javascript
var timingObject = new timingsrc.TimingObject(range, vector);
```

- param: optional {[start,end]} [range] range restrictions on timeline, start and and are floats (may be Infinity)
- param: optional {StateVector} [vector] initial state of timing object
- return: {Object} timing object

---
#### .query()
Returns a snapshot vector of the timing object

```javascript
var snapshotVector = timingObject.query();
```

- return: {StateVector} current state

---
#### .update()
Update issues a request for modification to the timing object.


```javascript
timingObject.update(vector);
```
- param:{StateVector} [vector] update initial state of timing object. 

State vectors given to update may be only partially complete. For instance, the below operation changes
the position of the timing object, while velocity and acceleration remains unchanged.

```javascript
timingObject.update({position:14.0});
```

---
#### Event types
Timing objects supports two event types ["change", "timeupdate"].

- Event type "change" is emitted after every update operation. 
- Event type "timeupdate" is emmitted at a fixed frequency (about 4Hz) as long as the the timing object is not paused.

Event handlers currently do not provide event arguments.

See also [eventing in timingsrc](#background_eventing.html) for *important* information about specific event semantics used in the timingsrc library. 

---
#### .on()
Registers an event handler on the timing object.

```javascript
timingObject.on(type, handler, ctx);
```

- param: {String} [type] event type ["change"|"timeupdate"]
- param: {Function} [handler] event handler
- param: optional {Object} [ctx] context for handler callback invocation, default is timingObject

---
#### .off()
Un-registers an event handler from the timing object.

```javascript
timingObject.off(type, handler);
```

- param: {String} [type] event type ["change"|"timeupdate"]
- param: {Function} [handler] event handler

---
#### .range
Getter for range of timing object

```javascript
var range = timingObject.range;
```

---
#### .clock
Getter for clock used by timing object.

```javascript
var timestamp = timingObject.clock.now();
```
---
#### .vector
Getter for internal vector of timing object. The internal vector is changed by update() and used by query() to calculate snapshots. 

```javascript
var vector = timingObject.vector;
```

---
#### .version
Getter for version of Timing Object implementation.

```javascript
var version = timingObject.version;
```