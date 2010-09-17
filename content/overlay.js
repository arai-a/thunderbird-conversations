/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Gmail Conversation View
 *
 * The Initial Developer of the Original Code is
 * Mozilla messaging
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

// Dear AMO reviewer, please note that this file has var EXPORTED_SYMBOLS = [];
Components.utils.import("resource://conversations/plugins/bugzilla.js");

var Conversations = {
  monkeyPatch: null,
  currentConversation: null,
  counter: 0,
};

window.addEventListener("load", function _overlay_eventListener () {
  let NS = {};
  Components.utils.import("resource://conversations/monkeypatch.js", NS);
  Components.utils.import("resource://conversations/conversation.js", NS);
  Components.utils.import("resource://conversations/prefs.js", NS);

  // We instanciate the Monkey-Patch for the given Conversation object.
  let monkeyPatch = new NS.MonkeyPatch(window, NS.Conversation);
  // And then we seize the window and insert our code into it
  try {
    monkeyPatch.apply();
  } catch (e) {
    dump(e+"\n");
    dump(e.stack+"\n");
  }
  Conversations.monkeyPatch = monkeyPatch;

  // Assistant. The setTimeout is here to ensure a smoother experience (this
  //  leaves the main window some to load properly).
  if (NS.Prefs.getInt("conversations.version") < 1) {
    setTimeout(function () {
      window.openDialog("chrome://conversations/content/assistant/assistant.html", "", "chrome,width=980,height=500");
    }, 2000);
  }
}, false);
