/**
 * @license
 * Copyright The Closure Library Authors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview ListFormat provides locale-sensitive list formatting with
 * conjuntion ("and"), the default, and disjunction ("or").
 * This uses ECMAScript native implementation if supported by the browser.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/ListFormat
 */

goog.module('goog.i18n.listFormat');
goog.module.declareLegacyNamespace();

const ListSymbols = goog.require('goog.i18n.ListFormatSymbols');
const LocaleFeature = goog.require('goog.i18n.LocaleFeature');

/**
 * Choices for options bag 'type' in ListFormat's constructor.
 * @enum {string} ListFormatType
 */
const ListFormatType = {
  AND: 'conjunction',
  OR: 'disjunction'
};
exports.ListFormatType = ListFormatType;


class ListFormat {
  /**
   * Returns the listformatter for the locale given by goog.LOCALE.
   * specified, a listformatter for the user's locale will be returned.
   * The single optional string parameter may have one of the enums
   * given in ListFormatType, which is either AND ('conjunction')
   * or OR ('disjunction'). These gives locale-specific lists formatted
   * using AND / OR respectively.
   *
   * @param {?{type: !ListFormatType}=} listOptions
   * @final
   */
  constructor(listOptions) {
    /**
     * A reference to a native Intl ListFormatter, only used when
     * USE_ECMASCRIPT_I18N_LISTFORMAT is true.
     * @private {?goog.global.Intl.ListFormat}
     */
    this.intlFormatter_ = null;

    /** @const @private @type {string} */
    this.listType_ = listOptions ? listOptions.type : ListFormatType.AND;

    if (LocaleFeature.USE_ECMASCRIPT_I18N_LISTFORMAT) {
      // Implement using ECMAScript Intl object.
      this.intlFormatter_ =
          new Intl.ListFormat(goog.LOCALE, {type: this.listType_});
    } else {
      // Implement using JavaScript, requiring data and code.

      /** @const @private @type {!ListSymbols.ListFormatSymbols} */
      this.ListSymbols_ = ListSymbols.getListFormatSymbols();

      /**
       * String for lists of exactly two items, containing {0} for the first,
       * and {1} for the second.
       * For instance '{0} and {1}' will give 'black and white'.
       * @private @type {string}
       *
       * Example: for "black and white" the pattern is "{0} and {1}"
       * Example: for "black or white" the pattern is "{0} or {1}"
       * While for a longer list we have "cyan, magenta, yellow, and black"
       * Think "{0} start {1} middle {2} middle {3} end {4}"
       * The last pattern is "{0}, and {1}." Note the comma before "and"/"or".
       * So the "Two" pattern can be different than Start/Middle/End ones.
       * Note that the TWO version is usually the same as END.
       */
      this.listTwoPattern_;
      if (this.listType_ === ListFormatType.AND) {
        this.listTwoPattern_ = this.ListSymbols_.LIST_TWO ?
            this.ListSymbols_.LIST_TWO :
            this.ListSymbols_.LIST_END;
      } else {
        this.listTwoPattern_ = this.ListSymbols_.OR_TWO ?
            this.ListSymbols_.OR_TWO :
            this.ListSymbols_.OR_END;
      }

      /**
       * String for the start of a list items, containing {0} for the first,
       * and {1} for the rest.
       * If LIST_START is the same as OR_START, OR_START may be omitted.
       * @private @type {string}
       */
      this.listStartPattern_;
      if (this.listType_ === ListFormatType.AND) {
        this.listStartPattern_ = this.ListSymbols_.LIST_START;
      } else {
        // Get the defined value from either OR_START or LIST_START.
        this.listStartPattern_ = this.ListSymbols_.OR_START ?
            this.ListSymbols_.OR_START :
            this.ListSymbols_.LIST_START;
      }

      /**
       * String for the start of a list items, containing {0} for the first part
       * of the list, and {1} for the rest of the list.
       * Note that the MIDDLE version is usually the same as START.
       * This value may fall back to OR_START or LIST_START.
       * @private @type {string}
       */
      this.listMiddlePattern_;
      if (this.listType_ === ListFormatType.AND) {
        this.listMiddlePattern_ = this.ListSymbols_.LIST_MIDDLE ?
            this.ListSymbols_.LIST_MIDDLE :
            this.ListSymbols_.LIST_START;
      } else {
        this.listMiddlePattern_ = this.ListSymbols_.OR_MIDDLE ?
            this.ListSymbols_.OR_MIDDLE :
            (this.ListSymbols_.OR_START ? this.ListSymbols_.OR_START :
                                          this.ListSymbols_.LIST_START);
      }

      /**
       * String for the end of a list items, containing {0} for the first part
       * of the list, and {1} for the last item.
       *
       * This is how start/middle/end come together with a conjuction or
       * disjunction start = '{0}, {1}'  middle = '{0}, {1}',  end = '{0},
       * and {1}' will result in the typical English list: 'one, two, three, and
       * four' or 'one, two, three, or four'. There are languages where the
       * patterns are more complex than '{1} someText {1}' and the start pattern
       * is different than the middle one.
       *
       * @const @private {string}
       */
      this.listEndPattern_ = (this.listType_ === ListFormatType.AND) ?
          this.ListSymbols_.LIST_END :
          this.ListSymbols_.OR_END;
    }
  }

  /**
   * Formats a list of items in either conjunctive or disjunctive form
   * with locale-specific punctuation and joining words.
   * @param {!Array<string|number>} items list of strings to be formatted
   * @return {string} formatted string for these items
   */
  format(items) {
    if (LocaleFeature.USE_ECMASCRIPT_I18N_LISTFORMAT) {
      return this.intlFormatter_.format(items);
    } else {
      // Implementation using JavaScript, requiring data and code.
      return this.formatJavaScript(items);
    }
  }

  /**
   * Replaces the {0} and {1} placeholders in a pattern with the first and
   * the second parameter respectively, and returns the result.
   * It is a helper function for goog.i18n.listFormat.format.
   *
   * @param {string} pattern used for formatting.
   * @param {string} first object to add to list.
   * @param {string} second object to add to list.
   * @return {string} The formatted list string.
   * @private
   */
  patternBasedJoinTwoStrings_(pattern, first, second) {
    'use strict';
    return pattern.replace('{0}', first).replace('{1}', second);
  }

  /**
   * Formats an array of strings into a string with JavaScript.
   * It is a user facing, locale-aware list (i.e. 'red, green, and blue').
   * Taken directly
   *
   * @param {!Array<string|number>} items Items to format.
   * @return {string} The items formatted into a string, as a list.
   * @private
   */
  formatJavaScript(items) {
    'use strict';
    const count = items.length;
    switch (count) {
      case 0:
        return '';
      case 1:
        return String(items[0]);
      case 2:
        return this.patternBasedJoinTwoStrings_(
            this.listTwoPattern_, String(items[0]), String(items[1]));
    }

    // More than two items
    let result = this.patternBasedJoinTwoStrings_(
        this.listStartPattern_, String(items[0]), String(items[1]));

    for (let i = 2; i < count - 1; ++i) {
      result = this.patternBasedJoinTwoStrings_(
          this.listMiddlePattern_, result, String(items[i]));
    }

    return this.patternBasedJoinTwoStrings_(
        this.listEndPattern_, result, String(items[count - 1]));
  }
}

exports.ListFormat = ListFormat;
