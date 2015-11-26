/*
	Copyright 2015 Norut Northern Research Institute
	Author : Ingar Mæhlum Arntzen

  This file is part of the Timingsrc module.

  Timingsrc is free software: you can redistribute it and/or modify
  it under the terms of the GNU Lesser General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  Timingsrc is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Lesser General Public License for more details.

  You should have received a copy of the GNU Lesser General Public License
  along with Timingsrc.  If not, see <http://www.gnu.org/licenses/>.
*/


/* 
	INTERVAL SEQUENCER

	- a collection of Intervals are defined on an axis
	- a searchInterval is defined by two endpoints.
	- we are interested in all Intervals on the axis that are partially/fully covered by searchInterval
	- we then want to move the searchInterval along the axis
	- trigger onenter/onexit events as Intervals go from being not covered to partialy/fully covered and vica versa
	- define searchInterval endpoints by two motions that may or may not be dependent
	- use pointsequencer on each motion to generate events.	
*/


define(['util/eventutils', 'util/motionutils', './sequencer'], 
	function (eventutils, motionutils, seq) {
	
	'use strict';

	/*
      unique
      return list of elements that are unique to array 1
     */
    var unique = function (array1, array2) {
		var res = [];
		for (var i=0; i<array1.length;i++) {
		    var found = false;
		    for (var j=0; j<array2.length;j++) {
				if (array1[i] === array2[j]) {
				    found = true;
				    break;
				} 
	    	}
	   		if (!found) {
				res.push(array1[i]);
	    	}	 
		}
		return res;
    };


	var Interval = seq.Interval;

	var IntervalSequencer = function (timingObjectA, timingObjectB) {
		this._axis = new seq.Axis();
		this._toA = timingObjectA;
		this._toB = timingObjectB;
		this._seqA = new seq.Sequencer(this._toA, this._axis);
		this._seqB = new seq.Sequencer(this._toB, this._axis);
		this._readyA = false;
		this._readyB = false;

		// active keys
		this._activeKeys = [];

		// Define Events API
		// event type "events" defined by default
		eventutils.eventify(this, IntervalSequencer.prototype);
		this.eventifyDefineEvent("enter", {init:true}) // define enter event (supporting init-event)
		this.eventifyDefineEvent("exit") 
		this.eventifyDefineEvent("change"); 

		// Wrapping prototype event handlers and store references on instance
		this._wrappedOnAxisChange = function () {this._onAxisChange();};
		this._wrappedOnTimingChangeA = function () {this._onTimingChangeA();};
		this._wrappedOnTimingChangeB = function () {this._onTimingChangeB();};
		this._wrappedOnSequencerChangeA = function () {this._onSequencerChangeA();};
		this._wrappedOnSequencerChangeB = function () {this._onSequencerChangeB();};

		this._axis.on("change", this._wrappedOnAxisChange, this);	
		this._toA.on("change", this._wrappedOnTimingChangeA, this);
		this._toB.on("change", this._wrappedOnTimingChangeB, this);
		this._seqA.on("events", this._wrappedOnSequencerChangeA, this);
		this._seqB.on("events", this._wrappedOnSequencerChangeB, this);
	};

	IntervalSequencer.prototype._isReady = function() {
		return (this._readyA && this._readyB);
	};


	/*

		API

	*/

	IntervalSequencer.prototype.addCue = function (key, interval, data) {
		return this._axis.updateAll([{key:key, interval:interval, data: data}]);
	};

	IntervalSequencer.prototype.removeCue = function (key, removedData) {
		return this._axis.updateAll([{key:key, interval:undefined, data:removedData}]);
	};


	/*

		EVENT HANDLERS

	*/

	IntervalSequencer.prototype._onTimingChangeA = function () {
		if (!this._readyA && this._readyB) console.log("ready");
		this._readyA = true;
		// should handle eList?
		this._resolve();
	}; 

	IntervalSequencer.prototype._onTimingChangeB = function () {
		if (this._readyA && !this._readyB) console.log("ready");
		this._readyB = true;
		// should handle eList?
		this._resolve();
	};

	IntervalSequencer.prototype._onAxisChange = function (opList) {
		// should handle opList?
		this._resolve();
	};

	IntervalSequencer.prototype._onSequencerChangeA = function (eList) {
		// should handle eList?
		this._resolve();
	}; 

	IntervalSequencer.prototype._onSequencerChangeB = function (eList) {
		// should handle eList?
		this._resolve();
	};

	/*
	  	overrides how immediate events are constructed
	*/
	IntervalSequencer.prototype.eventifyMakeInitEvents = function (type) {
		if (type === "enter") {
			return this._resolve();
		}
		return [];
	};

	/*
		RESOLVE

		Figure out what kind of events need to be triggered (if any)
		in order to bring the IntervalSequencer to the correct state.
	*/
	IntervalSequencer.prototype._resolve = function () {
		if (!this._isReady()) {
			return [];
		}

		// where are the timingObjects now?
		var vectorA = this._toA.query();
		var vectorB = this._toB.query();
		var start = Math.min(vectorA.position, vectorB.position);
		var end = Math.max(vectorA.position, vectorB.position);
		var searchInterval = new Interval(start, end, true, true);

		// find keys of all cues, where cue interval is partially or fully covered by searchInterval
		var oldKeys = this._activeKeys;		
		var newKeys = this._seqA.getCuesByInterval(searchInterval).map(function (item) {
			return item.key;
		});	
	    var exitKeys = unique(oldKeys, newKeys);
	    var enterKeys = unique(newKeys, oldKeys);

		// update active keys
	    this._activeKeys = newKeys;

	    // make event items from enter/exit keys
	    var eList = [];
	    var exitItems = exitKeys.forEach(function (key) {
	    	eList.push({type: "exit", e: {key:key, interval: this._axis.getIntervalByKey(key)}});
	    }, this);
	    var enterItems = enterKeys.forEach(function (key) {
	    	eList.push({type: "enter", e: {key:key, interval: this._axis.getIntervalByKey(key)}});
	    }, this);
	    this.eventifyTriggerEvents(eList);
 
	    // make event items from active keys
	    return this._activeKeys.map(function (key) {
	    	return {type: "enter", e: {key:key, interval: this._axis.getIntervalByKey(key)}};
	    }, this);
	};

	return IntervalSequencer;
});