/*!
 * https://github.com/Starcounter-Jack/Fast-JSON-Patch
 * json-patch-duplex.js 0.5.0
 * (c) 2013 Joachim Wester
 * MIT license
 */

/// <_reference path="lodash.d.ts" />

interface Object {
  observe : any;
  deliverChangeRecords : any;
  unobserve : any;
}

module jsonpatch {
  /* Do nothing if module is already defined.
     Doesn't look nice, as we cannot simply put 
     `!jsonpatch &&` before this immediate function call
     in TypeScript.
     */
/*  if (jsonpatch.observe) {
      return;
  }*/

  declare var _; //lodash

  var _objectKeys = (function () {
    if (Object.keys)
      return Object.keys;

    return function (o) { //IE8
      var keys = [];
      for (var i in o) {
        if (o.hasOwnProperty(i)) {
          keys.push(i);
        }
      }
      return keys;
    }
  })();

  function _equals(a, b) {
    switch (typeof a) {
      case 'undefined': //backward compatibility, but really I think we should return false
      case 'boolean':
      case 'string':
      case 'number':
        return a === b;
      case 'object':
        if (a === null)
          return b === null;
        if (_isArray(a)) {
          if (!_isArray(b) || a.length !== b.length)
            return false;

          for (var i = 0, l = a.length; i < l; i++)
            if (!_equals(a[i], b[i])) return false;

          return true;
        }

        var bKeys = _objectKeys(b);
        var bLength = bKeys.length;
        if (_objectKeys(a).length !== bLength)
          return false;

        for (var i = 0; i < bLength; i++)
          if (!_equals(a[i], b[i])) return false;

        return true;

      default:
        return false;

    }
  }

  /* We use a Javascript hash to store each
   function. Each hash entry (property) uses
   the operation identifiers specified in rfc6902.
   In this way, we can map each patch operation
   to its dedicated function in efficient way.
   */

  /* The operations applicable to an object */
  var objOps = {
    "+": function (obj, key) {
      obj[key] = this.value;
      return true;
    },
    '-': function (obj, key) {
      delete obj[key];
      return true;
    },
    '=': function (obj, key) {
      obj[key] = this.value;
      return true;
    },
    '/': function (obj, key, tree) {
      var temp:any = {op: "_get", path: this.from};
      apply(tree, [temp]);
      apply(tree, [
        {op: "-", path: this.from}
      ]);
      apply(tree, [
        {op: "+", path: this.path, value: temp.value}
      ]);
      return true;
    },
    '*': function (obj, key, tree) {
      var temp:any = {op: "_get", path: this.from};
      apply(tree, [temp]);
      apply(tree, [
        {op: "+", path: this.path, value: temp.value}
      ]);
      return true;
    },
    '?': function (obj, key) {
      return _equals(obj[key], this.value);
    },
    _get: function (obj, key) {
      this.value = obj[key];
    }
  };

  /* The operations applicable to an array. Many are the same as for the object */
  var arrOps = {
    "+": function (arr, i) {
      if (i > arr.length) {
        throw new Error("The specified index MUST NOT be greater than the number of elements in the array.");
      }
      arr.splice(i, 0, this.value);
      return true;
    },
    "-": function (arr, i) {
      arr.splice(i, 1);
      return true;
    },
    "=": function (arr, i) {
      arr[i] = this.value;
      return true;
    },
    "/": objOps['/'],
    "*": objOps['*'],
    "?": objOps['?'],
    _get: objOps._get
  };

  /* The operations applicable to object root. Many are the same as for the object */
  var rootOps = {
    "+": function (obj) {
      rootOps['-'].call(this, obj);
      for (var key in this.value) {
        if (this.value.hasOwnProperty(key)) {
          obj[key] = this.value[key];
        }
      }
      return true;
    },
    "-": function (obj) {
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          objOps['-'].call(this, obj, key);
        }
      }
      return true;
    },
    "=": function (obj) {
      apply(obj, [
        {op: "-", path: this.path}
      ]);
      apply(obj, [
        {op: "+", path: this.path, value: this.value}
      ]);
      return true;
    },
    "/": objOps['/'],
    "*": objOps['*'],
    "?": function (obj) {
      
      //return (JSON.stringify(obj) === JSON.stringify(this.value));
        return _.isEqual(obj, this.value);
    },
    _get: objOps._get
  };

  var observeOps = {
    add: function (patches:any[], path) {
      patches.push([
        "+",path + escapePathComponent(this.name),this.object[this.name]
      ]);
    },
    'delete': function (patches:any[], path) { //single quotes needed because 'delete' is a keyword in IE8
      patches.push([
        "-", path + escapePathComponent(this.name)
      ]);
    },
    update: function (patches:any[], path) {
      patches.push([
        "=",path + escapePathComponent(this.name),this.object[this.name]
      ]);
    }
  };

  function escapePathComponent (str) {
    if (str.indexOf('/') === -1 && str.indexOf('~') === -1) return str;
    return str.replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function _getPathRecursive(root:Object, obj:Object):string {
    var found;
    for (var key in root) {
      if (root.hasOwnProperty(key)) {
        if (root[key] === obj) {
          return escapePathComponent(key) + '/';
        }
        else if (typeof root[key] === 'object') {
          found = _getPathRecursive(root[key], obj);
          if (found != '') {
            return escapePathComponent(key) + '/' + found;
          }
        }
      }
    }
    return '';
  }

  function getPath(root:Object, obj:Object):string {
    if (root === obj) {
      return '/';
    }
    var path = _getPathRecursive(root, obj);
    if (path === '') {
      throw new Error("Object not found in root");
    }
    return '/' + path;
  }

  var beforeDict = [];

  export var intervals;

  class Mirror {
    obj: any;
    observers = [];

    constructor(obj:any){
      this.obj = obj;
    }
  }

  class ObserverInfo {
    callback: any;
    observer: any;

    constructor(callback, observer){
      this.callback = callback;
      this.observer = observer;
    }
  }

  function getMirror(obj:any):any {
    for (var i = 0, ilen = beforeDict.length; i < ilen; i++) {
      if (beforeDict[i].obj === obj) {
        return beforeDict[i];
      }
    }
  }

  function getObserverFromMirror(mirror:any, callback):any {
    for (var j = 0, jlen = mirror.observers.length; j < jlen; j++) {
      if (mirror.observers[j].callback === callback) {
        return mirror.observers[j].observer;
      }
    }
  }

  function removeObserverFromMirror(mirror:any, observer):any {
    for (var j = 0, jlen = mirror.observers.length; j < jlen; j++) {
      if (mirror.observers[j].observer === observer) {
        mirror.observers.splice(j, 1);
        return;
      }
    }
  }

  export function unobserve(root, observer) {
    generate(observer);
    if(Object.observe) {
      _unobserve(observer, root);
    }
    else {
      clearTimeout(observer.next);
    }

    var mirror = getMirror(root);
    removeObserverFromMirror(mirror, observer);

  }

  function deepClone(obj:any) {
    if (typeof obj === "object") {
        return _.clone(obj, true);
      //return JSON.parse(JSON.stringify(obj)); //Faster than ES5 clone - http://jsperf.com/deep-cloning-of-objects/5
    }
    else {
      return obj; //no need to clone primitives
    }
  }

  export function observe(obj:any, callback):any {
    var patches = [];
    var root = obj;
    var observer;
    var mirror = getMirror(obj);

    if (!mirror) {
      mirror = new Mirror(obj);
      beforeDict.push(mirror);
    } else {
      observer = getObserverFromMirror(mirror, callback);
    }

    if(observer){
      return observer;
    }

    if (Object.observe) {
      observer = function (arr) {
        //This "refresh" is needed to begin observing new object properties
        _unobserve(observer, obj);
        _observe(observer, obj);

        var a = 0
          , alen = arr.length;
        while (a < alen) {
          if (
            !(arr[a].name === 'length' && _isArray(arr[a].object))
              && !(arr[a].name === '__Jasmine_been_here_before__')
            ) {
            var type = arr[a].type;

            //old record type names before 10/29/2013 (http://wiki.ecmascript.org/doku.php?id=harmony:observe)
            //this block can be removed when Chrome 33 stable is released
            switch(type) {
              case 'new':
                type = 'add';
                break;

              case 'deleted':
                type = 'delete';
                break;

              case 'updated':
                type = 'update';
                break;
            }

            observeOps[type].call(arr[a], patches, getPath(root, arr[a].object));
          }
          a++;
        }

        if (patches) {
          if (callback) {
            callback(patches);
          }
        }
        observer.patches = patches;
        patches = [];


      };
    } else {
      observer = {};

      mirror.value = deepClone(obj);

      if (callback) {
        //callbacks.push(callback); this has no purpose
        observer.callback = callback;
        observer.next = null;
        var intervals = this.intervals || [100, 1000, 10000, 60000];
        if (intervals.push === void 0) {
          throw new Error("jsonpatch.intervals must be an array");
        }
        var currentInterval = 0;

        var dirtyCheck = function () {
          generate(observer);
        };
        var fastCheck = function () {
          clearTimeout(observer.next);
          observer.next = setTimeout(function () {
            dirtyCheck();
            currentInterval = 0;
            observer.next = setTimeout(slowCheck, intervals[currentInterval++]);
          }, 0);
        };
        var slowCheck = function () {
          dirtyCheck();
          if (currentInterval == intervals.length)
            currentInterval = intervals.length - 1;
          observer.next = setTimeout(slowCheck, intervals[currentInterval++]);
        };
        if (typeof window !== 'undefined') { //not Node
          if (window.addEventListener) { //standards
            window.addEventListener('mousedown', fastCheck);
            window.addEventListener('mouseup', fastCheck);
            window.addEventListener('keydown', fastCheck);
          }
          else { //IE8
            window.attachEvent('onmousedown', fastCheck);
            window.attachEvent('onmouseup', fastCheck);
            window.attachEvent('onkeydown', fastCheck);
          }
        }
        observer.next = setTimeout(slowCheck, intervals[currentInterval++]);
      }
    }
    observer.patches = patches;
    observer.object = obj;

    mirror.observers.push(new ObserverInfo(callback, observer));

    return _observe(observer, obj);
  }

  /// Listen to changes on an object tree, accumulate patches
  function _observe(observer:any, obj:any):any {
    if (Object.observe) {
      Object.observe(obj, observer);
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          var v:any = obj[key];
          if (v && typeof (v) === "object") {
            _observe(observer, v);
          }
        }
      }
    }
    return observer;
  }

  function _unobserve(observer:any, obj:any):any {
    if (Object.observe) {
      Object.unobserve(obj, observer);
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          var v:any = obj[key];
          if (v && typeof (v) === "object") {
            _unobserve(observer, v);
          }
        }
      }
    }
    return observer;
  }

  export function generate(observer) {
    if (Object.observe) {
      Object.deliverChangeRecords(observer);
    }
    else {
      var mirror;
      for (var i = 0, ilen = beforeDict.length; i < ilen; i++) {
        if (beforeDict[i].obj === observer.object) {
          mirror = beforeDict[i];
          break;
        }
      }
      _generate(mirror.value, observer.object, observer.patches, "");
      if(observer.patches.length) {
        apply(mirror.value, observer.patches);
      }
    }
    var temp = observer.patches;
    if(temp.length > 0) {
      observer.patches = [];
      if(observer.callback) {
        observer.callback(temp);
      }
    }
    return temp;
  }

  // Dirty check if obj is different from mirror, generate patches and update mirror
  function _generate(mirror, obj, patches, path) {
    var newKeys = _objectKeys(obj);
    var oldKeys = _objectKeys(mirror);
    var changed = false;
    var deleted = false;

    //if ever "move" operation is implemented here, make sure this test runs OK: "should not generate the same patch twice (move)"

    for (var t = oldKeys.length - 1; t >= 0; t--) {
      var key = oldKeys[t];
      var oldVal = mirror[key];
      if (obj.hasOwnProperty(key)) {
        var newVal = obj[key];
        if (oldVal instanceof Object) {
          _generate(oldVal, newVal, patches, path + "/" + escapePathComponent(key));
        }
        else {
          if (oldVal != newVal) {
            changed = true;
            patches.push([
                '=',path + "/" + escapePathComponent(key),deepClone(newVal)
            ]);
          }
        }
      }
      else {
        patches.push([
            '-',path + "/" + escapePathComponent(key)
        ]);
        deleted = true; // property has been deleted
      }
    }

    if (!deleted && newKeys.length == oldKeys.length) {
      return;
    }

    for (var t = 0; t < newKeys.length; t++) {
      var key = newKeys[t];
      if (!mirror.hasOwnProperty(key)) {
        patches.push([
            '+',path + "/" + escapePathComponent(key),deepClone(obj[key])
        ]);
      }
    }
  }

  var _isArray;
  if (Array.isArray) { //standards; http://jsperf.com/isarray-shim/4
    _isArray = Array.isArray;
  }
  else { //IE8 shim
    _isArray = function (obj:any) {
      return obj.push && typeof obj.length === 'number';
    }
  }

  //3x faster than cached /^\d+$/.test(str)
  function isInteger(str:string):boolean {
    var i = 0;
    var len = str.length;
    var charCode;
    while (i < len) {
      charCode = str.charCodeAt(i);
      if (charCode >= 48 && charCode <= 57) {
        i++;
        continue;
      }
      return false;
    }
    return true;
  }

  /// Apply a json-patch operation on an object tree
  export function apply(tree:any, patches:any[]):boolean {
    var result = false
        , p = 0
        , plen = patches.length
        , patch;
    while (p < plen) {
      patch = patches[p];
      p++;
      // Find the object
      var keys = patch.path.split('/');
      var obj = tree;
      var t = 1; //skip empty element - http://jsperf.com/to-shift-or-not-to-shift
      var len = keys.length;

      if (patch.value === undefined && (patch.op === "+" || patch.op === "=" || patch.op === "?")) {
        throw new Error("'value' MUST be defined");
      }
      if (patch.from === undefined && (patch.op === "*" || patch.op === "/")) {
        throw new Error("'from' MUST be defined");
      }

      while (true) {
        if (_isArray(obj)) {
          var index;
          if (keys[t] === '-') {
            index = obj.length;
          }
          else if (isInteger(keys[t])) {
            index = parseInt(keys[t], 10);
          }
          else {
            throw new Error("Expected an unsigned base-10 integer value, making the new referenced value the array element with the zero-based index");
          }
          t++;
          if (t >= len) {
            result = arrOps[patch.op].call(patch, obj, index, tree); // Apply patch
            break;
          }
          obj = obj[index];
        }
        else {
          var key = keys[t];
          if (key !== undefined) {
            if (key && key.indexOf('~') != -1)
              key = key.replace(/~1/g, '/').replace(/~0/g, '~'); // escape chars
            t++;
            if (t >= len) {
              result = objOps[patch.op].call(patch, obj, key, tree); // Apply patch
              break;
            }
          }
          else { //is root
            t++;
            if (t >= len) {
              result = rootOps[patch.op].call(patch, obj, key, tree); // Apply patch
              break;
            }
          }
          obj = obj[key];
        }
      }
    }
    return result;
  }

  export function compare(tree1:any, tree2:any):any[] {
    var patches = [];
    _generate(tree1, tree2, patches, '');
    return patches;
  }
}

declare var exports:any;

if (typeof exports !== "undefined") {
  exports.apply = jsonpatch.apply;
  exports.observe = jsonpatch.observe;
  exports.unobserve = jsonpatch.unobserve;
  exports.generate = jsonpatch.generate;
  exports.compare = jsonpatch.compare;
}
