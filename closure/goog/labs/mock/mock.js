/**
 * @license
 * Copyright The Closure Library Authors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Provides a mocking framework in Closure to make unit tests easy
 * to write and understand. The methods provided here can be used to replace
 * implementations of existing objects with 'mock' objects to abstract out
 * external services and dependencies thereby isolating the code under test.
 * Apart from mocking, methods are also provided to just monitor calls to an
 * object (spying) and returning specific values for some or all the inputs to
 * methods (stubbing).
 *
 * Manual: http://go/goog.labs.mock
 */


goog.provide('goog.labs.mock');
goog.provide('goog.labs.mock.TimeoutError');
goog.provide('goog.labs.mock.VerificationError');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.debug');
goog.require('goog.debug.Error');
goog.require('goog.functions');
goog.require('goog.labs.mock.timeout');
goog.require('goog.labs.mock.timeout.TimeoutMode');
goog.require('goog.labs.mock.verification');
goog.require('goog.labs.mock.verification.BaseVerificationMode');
goog.require('goog.labs.mock.verification.VerificationMode');
goog.require('goog.object');

goog.setTestOnly('goog.labs.mock');


/**
 * Mocks a given object or class.
 *
 * @param {!Object} objectOrClass An instance or a constructor of a class to be
 *     mocked.
 * @return {!Object} The mocked object.
 */
goog.labs.mock.mock = function(objectOrClass) {
  'use strict';
  // Go over properties of 'objectOrClass' and create a MockManager to
  // be used for stubbing out calls to methods.
  const mockObjectManager =
      new goog.labs.mock.MockObjectManager_(objectOrClass);
  const mockedObject = mockObjectManager.getMockedItem();
  goog.asserts.assertObject(mockedObject);
  return /** @type {!Object} */ (mockedObject);
};


/**
 * Mocks a given function.
 *
 * @param {!Function=} opt_func A function to be mocked.
 * @return {!Function} The mocked function.
 */
goog.labs.mock.mockFunction = function(opt_func) {
  'use strict';
  const mockFuncManager = new goog.labs.mock.MockFunctionManager_(
      goog.labs.mock.getFunctionName_(opt_func || function() {}));
  const mockedFunction = mockFuncManager.getMockedItem();
  goog.asserts.assertFunction(mockedFunction);
  return /** @type {!Function} */ (mockedFunction);
};


/**
 * Mocks a given constructor.
 *
 * @param {function(new:T, ...?)} ctor A constructor function to be mocked.
 * @return {function(new:T, ...?)} The mocked constructor.
 * @template T
 */
goog.labs.mock.mockConstructor = function(ctor) {
  'use strict';
  const mockCtor = goog.labs.mock.mockFunction(ctor);

  // Copy class members from the real constructor to the mock. Do not copy
  // the closure superClass_ property (see goog.inherits), the built-in
  // prototype property, or properties added to Function.prototype
  for (let property in ctor) {
    if (property != 'superClass_' && property != 'prototype' &&
        ctor.hasOwnProperty(property)) {
      mockCtor[property] = ctor[property];
    }
  }
  return mockCtor;
};


/**
 * Spies on a given object.
 *
 * @param {!Object} obj The object to be spied on.
 * @return {!Object} The spy object.
 */
goog.labs.mock.spy = function(obj) {
  'use strict';
  // Go over properties of 'obj' and create a MockSpyManager_ to
  // be used for spying on calls to methods.
  const mockSpyManager = new goog.labs.mock.MockSpyManager_(obj);
  const spyObject = mockSpyManager.getMockedItem();
  goog.asserts.assert(spyObject);
  return spyObject;
};


/**
 * Returns an object that can be used to verify calls to specific methods of a
 * given mock.
 * @param {!Object} obj The mocked object.
 * @param {!goog.labs.mock.verification.VerificationMode=} opt_verificationMode The mode
 *     under which to verify invocations.
 * @return {?} The verifier. Return type {?} to avoid compilation errors.
 * @suppress {strictMissingProperties} Part of the go/strict_warnings_migration
 */
goog.labs.mock.verify = function(obj, opt_verificationMode) {
  'use strict';
  const mode = opt_verificationMode || goog.labs.mock.verification.atLeast(1);
  obj.$verificationModeSetter(mode);

  return obj.$callVerifier;
};

/**
 * Returns an object that can be used to wait for calls to specific methods of a
 * given mock.
 * @param {!Object} obj The mocked object.
 * @param {...(!goog.labs.mock.verification.VerificationMode|
 *   !goog.labs.mock.timeout.TimeoutMode)} verificationOrTimeoutModes
 *   The mode under which to verify invocations.
 * @return {?} The waiter. Return type {?} to avoid compilation errors.
 * @suppress {strictMissingProperties} Part of the go/strict_warnings_migration
 */
goog.labs.mock.waitAndVerify = function(obj, ...verificationOrTimeoutModes) {
  goog.asserts.assert(
      verificationOrTimeoutModes.length <= 2,
      'At most 2 arguments may be passed as Timeout and Verification modes.');
  for (let i = 0; i < 2; i++) {
    const mode = verificationOrTimeoutModes[i];
    if (mode instanceof goog.labs.mock.timeout.TimeoutMode) {
      obj.$timeoutModeSetter(mode);
    } else if (
        mode instanceof goog.labs.mock.verification.BaseVerificationMode) {
      obj.$verificationModeSetter(mode);
    }
  }
  return obj.$callWaiter;
};

/**
 * Returns a name to identify a function. Named functions return their names,
 * unnamed functions return a string of the form '#anonymous{ID}' where ID is
 * a unique identifier for each anonymous function.
 * @private
 * @param {!Function} func The function.
 * @return {string} The function name.
 */
goog.labs.mock.getFunctionName_ = function(func) {
  'use strict';
  let funcName = goog.debug.getFunctionName(func);
  if (funcName == '' || funcName == '[Anonymous]') {
    funcName = '#anonymous' + goog.labs.mock.getUid(func);
  }
  return funcName;
};


/**
 * Returns a nicely formatted, readable representation of a method call.
 * @private
 * @param {string} methodName The name of the method.
 * @param {Array<?>=} opt_args The method arguments.
 * @return {string} The string representation of the method call.
 */
goog.labs.mock.formatMethodCall_ = function(methodName, opt_args) {
  'use strict';
  opt_args = opt_args || [];
  opt_args = opt_args.map(function(arg) {
    'use strict';
    if (typeof arg === 'function') {
      const funcName = goog.labs.mock.getFunctionName_(arg);
      return '<function ' + funcName + '>';
    } else {
      const isObjectWithClass = goog.isObject(arg) &&
          typeof arg !== 'function' && !Array.isArray(arg) &&
          arg.constructor != Object;
      if (isObjectWithClass) {
        return arg.toString();
      }
      return goog.labs.mock.formatValue_(arg);
    }
  });
  return methodName + '(' + opt_args.join(', ') + ')';
};


/**
 * An array to store objects for unique id generation.
 * @private
 * @type {!Array<!Object>}
 */
goog.labs.mock.uid_ = [];


/**
 * A unique Id generator that does not modify the object.
 * @param {Object!} obj The object whose unique ID we want to generate.
 * @return {number} an unique id for the object.
 */
goog.labs.mock.getUid = function(obj) {
  'use strict';
  let index = goog.labs.mock.uid_.indexOf(obj);
  if (index == -1) {
    index = goog.labs.mock.uid_.length;
    goog.labs.mock.uid_.push(obj);
  }
  return index;
};


/**
 * This is just another implementation of goog.debug.deepExpose with a more
 * compact format.
 * @private
 * @param {*} obj The object whose string representation will be returned.
 * @param {boolean=} opt_id Whether to include the id of objects or not.
 *     Defaults to true.
 * @return {string} The string representation of the object.
 */
goog.labs.mock.formatValue_ = function(obj, opt_id) {
  'use strict';
  const id = (opt_id !== undefined) ? opt_id : true;
  const previous = [];
  const output = [];

  const helper = function(obj) {
    'use strict';
    const indentMultiline = function(output) {
      'use strict';
      return output.replace(/\n/g, '\n');
    };


    try {
      if (obj === undefined) {
        output.push('undefined');
      } else if (obj === null) {
        output.push('NULL');
      } else if (typeof obj === 'string') {
        output.push('"' + indentMultiline(obj) + '"');
      } else if (typeof obj === 'function') {
        const funcName = goog.labs.mock.getFunctionName_(obj);
        output.push('<function ' + funcName + '>');
      } else if (goog.isObject(obj)) {
        if (goog.array.contains(previous, obj)) {
          if (id) {
            output.push(
                '<recursive/dupe obj_' + goog.labs.mock.getUid(obj) + '>');
          } else {
            output.push('<recursive/dupe>');
          }
        } else {
          previous.push(obj);
          output.push('{');
          for (let x in obj) {
            output.push(' ');
            output.push(
                '"' + x + '"' +
                ':');
            helper(obj[x]);
          }
          if (id) {
            output.push(' _id:' + goog.labs.mock.getUid(obj));
          }
          output.push('}');
        }
      } else {
        output.push(obj);
      }
    } catch (e) {
      output.push('*** ' + e + ' ***');
    }
  };

  helper(obj);
  return output.join('')
      .replace(/"closure_uid_\d+"/g, '_id')
      .replace(/{ /g, '{');
};



/**
 * Error thrown when verification failed.
 *
 * @param {Array<!goog.labs.mock.MethodBinding_>} recordedCalls
 *     The recorded calls that didn't match the expectation.
 * @param {string} methodName The expected method call.
 * @param {!goog.labs.mock.verification.VerificationMode} verificationMode The
 *     expected verification mode which failed verification.
 * @param {!Array<?>} args The expected arguments.
 * @constructor
 * @extends {goog.debug.Error}
 * @final
 */
goog.labs.mock.VerificationError = function(
    recordedCalls, methodName, verificationMode, args) {
  'use strict';
  const msg = goog.labs.mock.VerificationError.getVerificationErrorMsg_(
      recordedCalls, methodName, verificationMode, args);
  goog.labs.mock.VerificationError.base(this, 'constructor', msg);
};
goog.inherits(goog.labs.mock.VerificationError, goog.debug.Error);


/** @override */
goog.labs.mock.VerificationError.prototype.name = 'VerificationError';

/**
 * Error thrown when timeout triggers before specified action.
 *
 * @param {!Array<!goog.labs.mock.MethodBinding_>} recordedCalls
 *     The recorded calls that didn't match the expectation.
 * @param {string} methodName The expected method call.
 * @param {!goog.labs.mock.verification.VerificationMode} verificationMode The
 *     expected verification mode which failed verification.
 * @param {!Array<?>} args The expected arguments.
 * @constructor
 * @extends {goog.debug.Error}
 * @final
 */
goog.labs.mock.TimeoutError = function(
    recordedCalls, methodName, verificationMode, args) {
  'use strict';
  const msg = goog.labs.mock.TimeoutError.getTimeoutErrorMsg_(
      recordedCalls, methodName, verificationMode, args);
  goog.labs.mock.TimeoutError.base(this, 'constructor', msg);
};
goog.inherits(goog.labs.mock.TimeoutError, goog.debug.Error);

/** @override */
goog.labs.mock.TimeoutError.prototype.name = 'TimeoutError';

/**
 * This array contains the name of the functions that are part of the base
 * Object prototype.
 * Basically a copy of goog.object.PROTOTYPE_FIELDS_.
 * @const
 * @type {!Array<string>}
 * @private
 */
goog.labs.mock.PROTOTYPE_FIELDS_ = [
  'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toLocaleString', 'toString', 'valueOf'
];


/**
 * Constructs a descriptive error message for an expected method call.
 * @private
 * @param {Array<!goog.labs.mock.MethodBinding_>} recordedCalls
 *     The recorded calls that didn't match the expectation.
 * @param {string} methodName The expected method call.
 * @param {!goog.labs.mock.verification.VerificationMode} verificationMode The
 *     expected verification mode that failed verification.
 * @param {!Array<?>} args The expected arguments.
 * @return {string} The error message.
 */
goog.labs.mock.VerificationError.getVerificationErrorMsg_ = function(
    recordedCalls, methodName, verificationMode, args) {
  'use strict';
  recordedCalls = recordedCalls.filter(function(binding) {
    'use strict';
    return binding.getMethodName() == methodName;
  });

  const expected = goog.labs.mock.formatMethodCall_(methodName, args);

  let msg =
      '\nExpected: ' + expected.toString() + ' ' + verificationMode.describe();
  msg += '\nRecorded: ';

  if (recordedCalls.length > 0) {
    msg += recordedCalls.join(',\n          ');
  } else {
    msg += 'No recorded calls';
  }

  return msg;
};

/**
 * Constructs a descriptive error message for an expected method call
 * that was not triggered within a specified duration.
 * @private
 * @param {!Array<!goog.labs.mock.MethodBinding_>} recordedCalls
 *     The recorded calls that didn't match the expectation.
 * @param {string} methodName The expected method call.
 * @param {!goog.labs.mock.verification.VerificationMode} verificationMode The
 *     expected verification mode whose criteria was never met.
 * @param {!Array<?>} args The expected arguments.
 * @return {string} The error message.
 */
goog.labs.mock.TimeoutError.getTimeoutErrorMsg_ = function(
    recordedCalls, methodName, verificationMode, args) {
  'use strict';
  const verificationErrorMsg =
      goog.labs.mock.VerificationError.getVerificationErrorMsg_(
          recordedCalls, methodName, verificationMode, args);
  const timeoutErrorMsg =
      'Function call was either not invoked or never met criteria specified ' +
      'by provided verification mode. ' + verificationErrorMsg;
  return timeoutErrorMsg;
};



/**
 * Base class that provides basic functionality for creating, adding and
 * finding bindings, offering an executor method that is called when a call to
 * the stub is made, an array to hold the bindings and the mocked item, among
 * other things.
 *
 * @constructor
 * @struct
 * @private
 */
goog.labs.mock.MockManager_ = function() {
  'use strict';
  /**
   * Proxies the methods for the mocked object or class to execute the stubs.
   * @type {!Object}
   * @protected
   */
  this.mockedItem = {};

  /**
   * A reference to the object or function being mocked.
   * @type {?Object|?Function}
   * @protected
   */
  this.mockee = null;

  /**
   * Holds the stub bindings established so far.
   * @protected
   */
  this.methodBindings = [];

  /**
   * Holds a reference to the binder used to define stubs.
   * @protected
   */
  this.$stubBinder = null;

  /**
   * Record method calls with no stub definitions.
   * @type {!Array<!goog.labs.mock.MethodBinding_>}
   * @private
   */
  this.callRecords_ = [];

  /**
   * Which `VerificationMode` to use during verification.
   * @private
   */
  this.verificationMode_ = goog.labs.mock.verification.atLeast(1);

  /**
   * Which `TimeoutMode` to use during waitAndVerify.
   * @private
   */
  this.timeoutMode_ = goog.labs.mock.timeout.timeout(0);

  /**
   * Maintains a dictionary keyed by methodName, that holds a list of
   * callbacks that should be called anytime the provided methodName is called.
   * @type {!Object<string, !Set<function(!goog.labs.mock.MethodBinding_)>>}
   * @private
   * @const
   */
  this.callListeners_ = {};
};


/**
 * Allows callers of `#verify` to override the default verification
 * mode of this MockManager.
 *
 * @param {!goog.labs.mock.verification.VerificationMode} verificationMode
 * @private
 */
goog.labs.mock.MockManager_.prototype.setVerificationMode_ = function(
    verificationMode) {
  'use strict';
  this.verificationMode_ = verificationMode;
};

/**
 * Allows callers of `#waitAndVerify` to override the default timeout
 * mode of this MockManager.
 *
 * @param {!goog.labs.mock.timeout.TimeoutMode} timeoutMode
 * @private
 */
goog.labs.mock.MockManager_.prototype.setTimeoutMode_ = function(timeoutMode) {
  'use strict';
  this.timeoutMode_ = timeoutMode;
};

/**
 * Handles the first step in creating a stub, returning a stub-binder that
 * is later used to bind a stub for a method.
 *
 * @param {string} methodName The name of the method being bound.
 * @param {...*} var_args The arguments to the method.
 * @return {!goog.labs.mock.StubBinder} The stub binder.
 * @private
 */
goog.labs.mock.MockManager_.prototype.handleMockCall_ = function(
    methodName, var_args) {
  'use strict';
  const args = Array.prototype.slice.call(arguments, 1);
  return new goog.labs.mock.StubBinderImpl_(this, methodName, args);
};


/**
 * Returns the mock object. This should have a stubbed method for each method
 * on the object being mocked.
 *
 * @return {!Object|!Function} The mock object.
 */
goog.labs.mock.MockManager_.prototype.getMockedItem = function() {
  'use strict';
  return this.mockedItem;
};


/**
 * Adds a binding for the method name and arguments to be stubbed.
 *
 * @param {?string} methodName The name of the stubbed method.
 * @param {!Array<?>} args The arguments passed to the method.
 * @param {!Function} func The stub function.
 * @return {!Array<?>} The array of stubs for further sequential stubs to be
 *     appended.
 */
goog.labs.mock.MockManager_.prototype.addBinding = function(
    methodName, args, func) {
  'use strict';
  const binding = new goog.labs.mock.MethodBinding_(methodName, args, func);
  const sequentialStubsArray = [binding];
  goog.array.insertAt(this.methodBindings, sequentialStubsArray, 0);
  return sequentialStubsArray;
};


/**
 * Returns a stub, if defined, for the method name and arguments passed in.
 * If there are multiple stubs for this method name and arguments, then
 * the most recent binding will be used.
 *
 * If the next binding is a sequence of stubs, then they'll be returned
 * in order until only one is left, at which point it will be returned for
 * every subsequent call.
 *
 * @param {string} methodName The name of the stubbed method.
 * @param {!Array<?>} args The arguments passed to the method.
 * @return {?Function} The stub function or null.
 * @protected
 */
goog.labs.mock.MockManager_.prototype.getNextBinding = function(
    methodName, args) {
  'use strict';
  const bindings = this.methodBindings.find(function(bindingArray) {
    'use strict';
    return bindingArray[0].matches(
        methodName, args, false /* isVerification */);
  });
  if (bindings == null) {
    return null;
  }

  if (bindings.length > 1) {
    return bindings.shift().getStub();
  }
  return bindings[0].getStub();
};


/**
 * Returns a stub, if defined, for the method name and arguments passed in as
 * parameters.
 *
 * @param {string} methodName The name of the stubbed method.
 * @param {!Array<?>} args The arguments passed to the method.
 * @return {Function} The stub function or undefined.
 * @protected
 */
goog.labs.mock.MockManager_.prototype.getExecutor = function(methodName, args) {
  'use strict';
  return this.getNextBinding(methodName, args);
};


/**
 * Looks up the list of stubs defined on the mock object and executes the
 * function associated with that stub.
 *
 * @param {string} methodName The name of the method to execute.
 * @param {...*} var_args The arguments passed to the method.
 * @return {*} Value returned by the stub function.
 * @protected
 */
goog.labs.mock.MockManager_.prototype.executeStub = function(
    methodName, var_args) {
  'use strict';
  const args = Array.prototype.slice.call(arguments, 1);

  const callRecord = this.recordCall_(methodName, args);

  if (this.callListeners_[methodName] instanceof Set) {
    this.callListeners_[methodName].forEach((listener) => {
      listener(callRecord);
    });
  }

  const func = this.getExecutor(methodName, args);
  if (func) {
    return func.apply(null, args);
  }
};


/**
 * Records a call to 'methodName' with arguments 'args'.
 *
 * @param {string} methodName The name of the called method.
 * @param {!Array<?>} args The array of arguments.
 * @return {!goog.labs.mock.MethodBinding_} The call record that was recorded.
 * @private
 */
goog.labs.mock.MockManager_.prototype.recordCall_ = function(methodName, args) {
  'use strict';
  const callRecord =
      new goog.labs.mock.MethodBinding_(methodName, args, () => {});

  this.callRecords_.push(callRecord);
  return callRecord;
};


/**
 * Verify invocation of a method with specific arguments.
 *
 * @param {string} methodName The name of the method.
 * @param {...*} var_args The arguments passed.
 * @protected
 */
goog.labs.mock.MockManager_.prototype.verifyInvocation = function(
    methodName, var_args) {
  'use strict';
  const args = Array.prototype.slice.call(arguments, 1);
  const count =
      this.callRecords_
          .filter(function(binding) {
            'use strict';
            return binding.matches(methodName, args, true /* isVerification */);
          })
          .length;

  if (!this.verificationMode_.verify(count)) {
    throw new goog.labs.mock.VerificationError(
        this.callRecords_, methodName, this.verificationMode_, args);
  }
};

/**
 * Wait until a function is called and then resolve.
 * @param {string} methodName The name of the method.
 * @param {...*} args The arguments passed.
 * @return {!Promise} A promise that resolves when the method is called
 *     according to its verification mode.
 * @protected
 */
goog.labs.mock.MockManager_.prototype.waitForCall = function(
    methodName, ...args) {
  let count =
      this.callRecords_
          .filter(function(binding) {
            return binding.matches(methodName, args, true /* isVerification */);
          })
          .length;

  return new Promise((resolve, reject) => {
    // If the function has already been called, immediately resolve.
    if (this.verificationMode_.verify(count)) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reject(new goog.labs.mock.TimeoutError(
          this.callRecords_, methodName, this.verificationMode_, args));
      this.callListeners_[methodName].delete(listener);
    }, this.timeoutMode_.duration);

    if (!this.callListeners_[methodName]) {
      this.callListeners_[methodName] = new Set();
    }

    /**
     * Listens for calls to this function name
     * @param {!goog.labs.mock.MethodBinding_} callRecord The call record
     *     just added
     * @this {goog.labs.mock.MockManager_}
     */
    const listener = (callRecord) => {
      if (callRecord.matches(methodName, args, true /* isVerification */)) {
        count++;
        if (this.verificationMode_.verify(count)) {
          resolve();
          clearTimeout(timeout);
          this.callListeners_[methodName].delete(listener);
        }
      }
    };

    this.callListeners_[methodName].add(listener);
  });
};



/**
 * Sets up mock for the given object (or class), stubbing out all the defined
 * methods. By default, all stubs return `undefined`, though stubs can be
 * later defined using `goog.labs.mock.when`.
 * @struct
 * @constructor
 * @extends {goog.labs.mock.MockManager_}
 * @param {!Object|!Function} objOrClass The object or class to set up the
 *     mock for. A class is a constructor function.
 * @private
 * @suppress {strictMissingProperties} Part of the
 * go/strict_warnings_migration
 */
goog.labs.mock.MockObjectManager_ = function(objOrClass) {
  'use strict';
  goog.labs.mock.MockObjectManager_.base(this, 'constructor');

  /**
   * Proxies the calls to establish the first step of the stub bindings
   * (object and method name)
   * @private
   */
  this.objectStubBinder_ = {};

  this.mockee = objOrClass;

  /**
   * The call verifier is used to verify the calls. It maps property names to
   * the method that does call verification.
   * @type {!Object<string, function(string, ...)>}
   * @private
   */
  this.objectCallVerifier_ = {};

  /**
   * The call waiter is used to wait for function calls. It returns a resolved
   * promise when the function is eventually called.
   * @type {!Object<string, function(string, ...)>}
   * @private
   * @const
   */
  this.objectCallWaiter_ = {};

  let obj;
  if (typeof objOrClass === 'function') {
    // Create a temporary subclass with a no-op constructor so that we can
    // create an instance and determine what methods it has.
    /**
     * @constructor
     * @final
     */
    const tempCtor = function() {};
    goog.inherits(tempCtor, objOrClass);
    obj = new tempCtor();
  } else {
    obj = objOrClass;
  }

  // Put the object being mocked in the prototype chain of the mock so that
  // it has all the correct properties and instanceof works.
  /**
   * @constructor
   * @final
   */
  const mockedItemCtor = function() {};
  mockedItemCtor.prototype = obj;
  this.mockedItem = new mockedItemCtor();

  const propObj =
      typeof objOrClass === 'function' ? objOrClass.prototype : objOrClass;
  const enumerableProperties = goog.object.getAllPropertyNames(propObj);
  // The non enumerable properties are added due to the fact that IE8 does not
  // enumerate any of the prototype Object functions even when overridden and
  // mocking these is sometimes needed.
  for (let i = 0; i < goog.labs.mock.PROTOTYPE_FIELDS_.length; i++) {
    const prop = goog.labs.mock.PROTOTYPE_FIELDS_[i];
    if (!goog.array.contains(enumerableProperties, prop)) {
      enumerableProperties.push(prop);
    }
  }

  // Adds the properties to the mock, creating a proxy stub for each method on
  // the instance.
  for (let i = 0; i < enumerableProperties.length; i++) {
    const prop = enumerableProperties[i];
    if (typeof propObj[prop] === 'function') {
      this.mockedItem[prop] = goog.bind(this.executeStub, this, prop);
      // The stub binder used to create bindings.
      this.objectStubBinder_[prop] =
          goog.bind(this.handleMockCall_, this, prop);
      // The verifier verifies the calls.
      this.objectCallVerifier_[prop] =
          goog.bind(this.verifyInvocation, this, prop);
      // The call waiter waits for calls.
      this.objectCallWaiter_[prop] = goog.bind(this.waitForCall, this, prop);
    }
  }
  // The alias for stub binder exposed to the world.
  this.mockedItem.$stubBinder = this.objectStubBinder_;

  // The alias for verifier for the world.
  this.mockedItem.$callVerifier = this.objectCallVerifier_;

  this.mockedItem.$callWaiter = this.objectCallWaiter_;

  this.mockedItem.$verificationModeSetter =
      goog.bind(this.setVerificationMode_, this);

  this.mockedItem.$timeoutModeSetter = goog.bind(this.setTimeoutMode_, this);
};
goog.inherits(goog.labs.mock.MockObjectManager_, goog.labs.mock.MockManager_);



/**
 * Sets up the spying behavior for the given object.
 *
 * @param {!Object} obj The object to be spied on.
 *
 * @constructor
 * @struct
 * @extends {goog.labs.mock.MockObjectManager_}
 * @private
 */
goog.labs.mock.MockSpyManager_ = function(obj) {
  'use strict';
  goog.labs.mock.MockSpyManager_.base(this, 'constructor', obj);
};
goog.inherits(
    goog.labs.mock.MockSpyManager_, goog.labs.mock.MockObjectManager_);


/**
 * Return a stub, if defined, for the method and arguments passed in. If we
 * lack a stub, instead look for a call record that matches the method and
 * arguments.
 *
 * @return {!Function} The stub or the invocation logger, if defined.
 * @override
 */
goog.labs.mock.MockSpyManager_.prototype.getNextBinding = function(
    methodName, args) {
  'use strict';
  let stub = goog.labs.mock.MockSpyManager_.base(
      this, 'getNextBinding', methodName, args);

  if (!stub) {
    stub = goog.bind(this.mockee[methodName], this.mockedItem);
  }

  return stub;
};



/**
 * Sets up mock for the given function, stubbing out. By default, all stubs
 * return `undefined`, though stubs can be later defined using
 * `goog.labs.mock.when`.
 * @struct
 * @constructor
 * @extends {goog.labs.mock.MockManager_}
 * @param {string} name The name of the function to set up the mock for.
 * @private
 * @suppress {strictMissingProperties} Part of the
 * go/strict_warnings_migration
 */
goog.labs.mock.MockFunctionManager_ = function(name) {
  'use strict';
  goog.labs.mock.MockFunctionManager_.base(this, 'constructor');

  this.name_ = name;

  /**
   * The stub binder used to create bindings.
   * Sets the first argument of handleMockCall_ to the function name.
   * @type {!Function}
   * @private
   */
  this.functionStubBinder_ = this.useMockedFunctionName_(this.handleMockCall_);

  this.mockedItem = this.useMockedFunctionName_(this.executeStub);
  this.mockedItem.$stubBinder = this.functionStubBinder_;

  /**
   * The call verifier is used to verify function invocations.
   * Sets the first argument of verifyInvocation to the function name.
   * @type {!Function}
   */
  this.mockedItem.$callVerifier =
      this.useMockedFunctionName_(this.verifyInvocation);

  /**
   * The call waiter is used to wait for function calls.
   * Sets the first argument of waitForCall to the function name.
   * @type {!Function}
   */
  this.mockedItem.$callWaiter = this.useMockedFunctionName_(this.waitForCall);

  // These have to be repeated because if they're set in the base class they
  // will be stubbed by MockObjectManager.
  this.mockedItem.$verificationModeSetter =
      goog.bind(this.setVerificationMode_, this);
  this.mockedItem.$timeoutModeSetter = goog.bind(this.setTimeoutMode_, this);
};
goog.inherits(goog.labs.mock.MockFunctionManager_, goog.labs.mock.MockManager_);


/**
 * Given a method, returns a new function that calls the first one setting
 * the first argument to the mocked function name.
 * This is used to dynamically override the stub binders and call verifiers.
 * @private
 * @param {Function} nextFunc The function to override.
 * @return {!Function} The overloaded function.
 */
goog.labs.mock.MockFunctionManager_.prototype.useMockedFunctionName_ = function(
    nextFunc) {
  'use strict';
  const mockFunctionManager = this;
  // Avoid using 'this' because this function may be called with 'new'.
  return function(var_args) {
    'use strict';
    const args = Array.prototype.slice.call(arguments);
    const name = '#mockFor<' + mockFunctionManager.name_ + '>';
    goog.array.insertAt(args, name, 0);
    return nextFunc.apply(mockFunctionManager, args);
  };
};


/**
 * A stub binder is an object that helps define the stub by binding
 * method name to the stub method.
 * @interface
 */
goog.labs.mock.StubBinder = function() {};


/**
 * Defines the function to be called for the method name and arguments bound
 * to this `StubBinder`.
 *
 * If `then` or `thenReturn` has been previously called
 * on this `StubBinder` then the given stub `func` will be called
 * only after the stubs passed previously have been called.  Afterwards,
 * if no other calls are made to `then` or `thenReturn` for this
 * `StubBinder` then the given `func` will be used for every further
 * invocation.
 * See #when for complete examples.
 * TODO(vbhasin): Add support for the 'Answer' interface.
 *
 * @param {!Function} func The function to call.
 * @return {!goog.labs.mock.StubBinder} Returns itself for chaining.
 */
goog.labs.mock.StubBinder.prototype.then = goog.abstractMethod;


/**
 * Defines the constant return value for the stub represented by this
 * `StubBinder`.
 *
 * @param {*} value The value to return.
 * @return {!goog.labs.mock.StubBinder} Returns itself for chaining.
 */
goog.labs.mock.StubBinder.prototype.thenReturn = goog.abstractMethod;


/**
 * A `StubBinder` which uses `MockManager_` to manage stub
 * bindings.
 *
 * @param {!goog.labs.mock.MockManager_}
 *   mockManager The mock manager.
 * @param {?string} name The method name.
 * @param {!Array<?>} args The other arguments to the method.
 *
 * @implements {goog.labs.mock.StubBinder}
 * @private @constructor @struct @final
 */
goog.labs.mock.StubBinderImpl_ = function(mockManager, name, args) {
  'use strict';
  /**
   * The mock manager instance.
   * @type {!goog.labs.mock.MockManager_}
   * @private
   */
  this.mockManager_ = mockManager;

  /**
   * Holds the name of the method to be bound.
   * @type {?string}
   * @private
   */
  this.name_ = name;

  /**
   * Holds the arguments for the method.
   * @type {!Array<?>}
   * @private
   */
  this.args_ = args;

  /**
   * Stores a reference to the list of stubs to allow chaining sequential
   * stubs.
   * @private {!Array<?>}
   */
  this.sequentialStubsArray_ = [];
};


/**
 * @override
 */
goog.labs.mock.StubBinderImpl_.prototype.then = function(func) {
  'use strict';
  if (this.sequentialStubsArray_.length) {
    this.sequentialStubsArray_.push(
        new goog.labs.mock.MethodBinding_(this.name_, this.args_, func));
  } else {
    this.sequentialStubsArray_ =
        this.mockManager_.addBinding(this.name_, this.args_, func);
  }
  return this;
};


/**
 * @override
 */
goog.labs.mock.StubBinderImpl_.prototype.thenReturn = function(value) {
  'use strict';
  return this.then(goog.functions.constant(value));
};


/**
 * Facilitates (and is the first step in) setting up stubs. Obtains an object
 * on which, the method to be mocked is called to create a stub. Sample usage:
 *
 * var mockObj = goog.labs.mock.mock(objectBeingMocked);
 * goog.labs.mock.when(mockObj).getFoo(3).thenReturn(4);
 *
 * Subsequent calls to `when` take precedence over earlier calls, allowing
 * users to set up default stubs in setUp methods and then override them in
 * individual tests.
 *
 * If a user wants sequential calls to their stub to return different
 * values, they can chain calls to `then` or `thenReturn` as
 * follows:
 *
 * var mockObj = goog.labs.mock.mock(objectBeingMocked);
 * goog.labs.mock.when(mockObj).getFoo(3)
 *     .thenReturn(4)
 *     .then(function() {
 *         throw new Error('exceptional case');
 *     });
 * @param {!Object} mockObject The mocked object.
 * @return {?} The property binder. Return type {?} to avoid compilation
 *     errors.
 * @suppress {strictMissingProperties} Part of the
 * go/strict_warnings_migration
 */
goog.labs.mock.when = function(mockObject) {
  'use strict';
  goog.asserts.assert(mockObject.$stubBinder, 'Stub binder cannot be null!');
  return mockObject.$stubBinder;
};



/**
 * Represents a binding between a method name, args and a stub.
 *
 * @param {?string} methodName The name of the method being stubbed.
 * @param {!Array<?>} args The arguments passed to the method.
 * @param {!Function} stub The stub function to be called for the given
 *     method.
 * @constructor
 * @struct
 * @private
 */
goog.labs.mock.MethodBinding_ = function(methodName, args, stub) {
  'use strict';
  /**
   * The name of the method being stubbed.
   * @type {?string}
   * @private
   */
  this.methodName_ = methodName;

  /**
   * The arguments for the method being stubbed.
   * @type {!Array<?>}
   * @private
   */
  this.args_ = args;

  /**
   * The stub function.
   * @type {!Function}
   * @private
   */
  this.stub_ = stub;
};


/**
 * @return {!Function} The stub to be executed.
 */
goog.labs.mock.MethodBinding_.prototype.getStub = function() {
  'use strict';
  return this.stub_;
};


/**
 * @override
 * @return {string} A readable string representation of the binding
 *  as a method call.
 */
goog.labs.mock.MethodBinding_.prototype.toString = function() {
  'use strict';
  return goog.labs.mock.formatMethodCall_(this.methodName_ || '', this.args_);
};


/**
 * @return {string} The method name for this binding.
 */
goog.labs.mock.MethodBinding_.prototype.getMethodName = function() {
  'use strict';
  return this.methodName_ || '';
};


/**
 * Determines whether the given args match the stored args_. Used to determine
 * which stub to invoke for a method.
 *
 * @param {string} methodName The name of the method being stubbed.
 * @param {!Array<?>} args An array of arguments.
 * @param {boolean} isVerification Whether this is a function verification
 *     call or not.
 * @return {boolean} If it matches the stored arguments.
 */
goog.labs.mock.MethodBinding_.prototype.matches = function(
    methodName, args, isVerification) {
  'use strict';
  const specs = isVerification ? args : this.args_;
  const calls = isVerification ? this.args_ : args;

  // TODO(vbhasin): More elaborate argument matching. Think about matching
  //    objects.
  return this.methodName_ == methodName &&
      goog.array.equals(calls, specs, function(arg, spec) {
        'use strict';
        // Duck-type to see if this is an object that implements the
        // goog.labs.testing.Matcher interface.
        if (spec && typeof spec.matches === 'function') {
          return spec.matches(arg);
        } else {
          return goog.array.defaultCompareEquality(spec, arg);
        }
      });
};
