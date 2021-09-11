/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * This reducer is for managing the control flow of the stub page. Handling
 * triggering of actions related to the loading of conversations data and
 * subsequent display.
 */

/* global Conversation, BrowserSim, topMail3Pane */
import { mergeContactDetails } from "./contacts.js";
import { messageEnricher } from "./messages.js";
import { messageActions } from "./reducer-messages.js";
import { composeSlice } from "./reducer-compose.js";
import { summaryActions } from "./reducer-summary.js";
import { quickReplySlice } from "./reducer-quickReply.js";

let loggingEnabled = false;

async function handleShowDetails(messages, state, dispatch, updateFn) {
  let defaultShowing = state.summary.defaultDetailsShowing;
  for (let msg of messages.msgData) {
    msg.detailsShowing = defaultShowing;
  }

  await updateFn();

  if (defaultShowing) {
    for (let msg of state.messages.msgData) {
      await dispatch(
        messageActions.showMsgDetails({
          id: msg.id,
          detailsShowing: true,
        })
      );
    }
  }
}

// TODO: Once the WebExtension parts work themselves out a bit more,
// determine if this is worth sharing via a shared module with the background
// scripts, or if it doesn't need it.

async function setupConversationInTab(params, isInTab) {
  if (window.frameElement) {
    window.frameElement.setAttribute("tooltip", "aHTMLTooltip");
  }
  const msgUrls = params.get("urls").split(",");
  const msgIds = [];
  for (const url of msgUrls) {
    const id = await browser.conversations.getMessageIdForUri(url);
    if (id) {
      msgIds.push(id);
    }
  }
  // It might happen that there are no messages left...
  if (!msgIds.length) {
    document.getElementById("messageList").textContent =
      browser.i18n.getMessage("message.movedOrDeletedConversation");
  } else {
    window.Conversations = {
      currentConversation: null,
      counter: 0,
    };

    let freshConversation = new Conversation(
      window,
      // TODO: This should really become ids at some stage, but we need to
      // teach Conversation how to handle those.
      msgUrls,
      ++window.Conversations.counter,
      isInTab
    );
    let browserFrame = window.frameElement;
    // Because Thunderbird still hasn't fixed that...
    if (browserFrame) {
      browserFrame.setAttribute("context", "mailContext");
    }

    window.Conversations.currentConversation = freshConversation;
    freshConversation.outputInto(window);
  }
}

function onMsgHasRemoteContent(dispatch, id) {
  dispatch(
    messageActions.setHasRemoteContent({
      id,
      hasRemoteContent: true,
    })
  );
}

async function onUpdateSecurityStatus(
  dispatch,
  { id, signedStatus, encryptionStatus, encryptionNotification, details }
) {
  if (signedStatus) {
    await dispatch(
      messageActions.msgAddSpecialTag({
        id,
        tagDetails: {
          // canClick: true,
          classNames: "enigmail-signed",
          icon: "material-icons.svg#edit",
          name: browser.i18n.getMessage("enigmail.messageSigned"),
          details: {
            type: "enigmail",
            detail: "viewSecurityInfo",
            displayInfo: details,
          },
          title:
            signedStatus == "warn"
              ? browser.i18n.getMessage("enigmail.unknownGood")
              : browser.i18n.getMessage("enigmail.messageSignedLong"),
          type: "openPgpSigned",
        },
      })
    );
  }
  if (!encryptionStatus) {
    return;
  }

  if (encryptionStatus == "good") {
    dispatch(
      messageActions.msgAddSpecialTag({
        id,
        tagDetails: {
          classNames: "enigmail-decrypted",
          icon: "material-icons.svg#vpn_key",
          name: browser.i18n.getMessage("enigmail.messageDecrypted"),
          details: {
            type: "enigmail",
            detail: "viewSecurityInfo",
            displayInfo: details,
          },
          title: browser.i18n.getMessage("enigmail.messageDecryptedLong"),
        },
      })
    );
    return;
  }
  if (encryptionStatus == "bad") {
    if (encryptionNotification) {
      dispatch(
        messageActions.msgShowNotification({
          msgData: {
            id,
            notification: {
              iconName: "dangerous",
              label: encryptionNotification,
              type: "openpgp",
            },
          },
        })
      );
    }
  }
}

function onSmimeReload(dispatch, id) {
  if (loggingEnabled) {
    console.log("smimeReloadListener", id);
  }
  dispatch(
    messageActions.setSmimeReload({
      id,
      smimeReload: true,
    })
  );
}

export const controllerActions = {
  waitForStartup() {
    return async (dispatch, getState) => {
      const params = new URL(document.location).searchParams;

      const isInTab = params.has("urls");
      const isStandalone = params.has("standalone");
      const topWin = topMail3Pane(window);

      // Note: Moving this to after the check for started below is dangerous,
      // since it introduces races where `Conversation` doesn't wait for the
      // page to startup, and hence tab id isn't set.
      let windowId = BrowserSim.getWindowId(topWin);
      await dispatch(
        summaryActions.setConversationState({
          isInTab,
          isStandalone,
          tabId: BrowserSim.getTabId(topWin, window),
          windowId,
        })
      );

      await dispatch(summaryActions.setupListeners());
      await dispatch(summaryActions.setupUserPreferences());

      const platformInfo = await browser.runtime.getPlatformInfo();
      const defaultFontSize = await browser.conversations.getCorePref(
        "font.size.variable.x-western"
      );
      const browserForegroundColor = await browser.conversations.getCorePref(
        "browser.display.foreground_color"
      );
      const browserBackgroundColor = await browser.conversations.getCorePref(
        "browser.display.background_color"
      );
      const defaultDetailsShowing =
        (await browser.conversations.getCorePref("mail.show_headers")) == 2;
      const autoMarkAsRead =
        (await browser.conversations.getCorePref(
          "mailnews.mark_message_read.auto"
        )) &&
        !(await browser.conversations.getCorePref(
          "mailnews.mark_message_read.delay"
        ));

      await dispatch(
        summaryActions.setSystemOptions({
          autoMarkAsRead,
          browserForegroundColor,
          browserBackgroundColor,
          defaultDetailsShowing,
          defaultFontSize,
          OS: platformInfo.os,
        })
      );

      if (getState().summary.prefs.loggingEnabled) {
        loggingEnabled = true;
        console.debug(`Initializing ${isInTab ? "tab" : "message pane"} view.`);
      }

      let remoteContentListener = onMsgHasRemoteContent.bind(this, dispatch);
      browser.convMsgWindow.onMsgHasRemoteContent.addListener(
        remoteContentListener,
        windowId
      );
      let updateSecurityStatusListener = onUpdateSecurityStatus.bind(
        this,
        dispatch
      );
      let smimeReloadListener = onSmimeReload.bind(this, dispatch);
      browser.convOpenPgp.onUpdateSecurityStatus.addListener(
        updateSecurityStatusListener,
        windowId
      );
      browser.convOpenPgp.onSMIMEReload.addListener(
        smimeReloadListener,
        windowId
      );
      window.addEventListener(
        "unload",
        () => {
          browser.convMsgWindow.onMsgHasRemoteContent.removeListener(
            remoteContentListener,
            windowId
          );
          browser.convOpenPgp.onUpdateSecurityStatus.removeListener(
            updateSecurityStatusListener,
            windowId
          );
          browser.convOpenPgp.onSMIMEReload.removeListener(
            smimeReloadListener,
            windowId
          );
        },
        { once: true }
      );

      if (!isInTab) {
        return;
      }

      await new Promise((resolve, reject) => {
        let tries = 0;
        function checkStarted() {
          let mainWindow = topMail3Pane(window);
          if (
            mainWindow.Conversations &&
            mainWindow.Conversations.finishedStartup
          ) {
            resolve();
          } else {
            // Wait up to 10 seconds, if it is that slow we're in trouble.
            if (tries >= 100) {
              console.error("Failed waiting for monkeypatch to finish startup");
              reject();
              return;
            }
            tries++;
            setTimeout(checkStarted, 100);
          }
        }
        checkStarted();
      });
      await dispatch(
        controllerActions.initializeMessageThread({ isInTab: true, params })
      );
    };
  },

  initializeMessageThread({ isInTab, params }) {
    return async (dispatch, getState) => {
      if (getState().summary.isInTab) {
        setupConversationInTab(params, isInTab).catch(console.error);
      }
    };
  },

  /**
   * Update a conversation either replacing or appending the messages.
   *
   * @param {object} root0
   * @param {object} [root0.summary]
   *   Only applies to replacing a conversation, the summary details to update.
   * @param {object} root0.messages
   *   The messages to insert or append.
   * @param {string} root0.mode
   *   Can be "append", "replaceAll" or "replaceMsg". replaceMsg will replace
   *   only a single message.
   */
  updateConversation({ summary, messages, mode }) {
    return async (dispatch, getState) => {
      const state = getState();
      await handleShowDetails(messages, state, dispatch, async () => {
        // The messages need some more filling out and tweaking.
        await messageEnricher.enrich(
          mode,
          messages.msgData,
          state.summary,
          mode == "replaceAll" ? summary.initialSet : state.summary.initialSet
        );

        // The messages inside `msgData` don't come with filled in `to`/`from`/ect. fields.
        // We need to fill them in ourselves.
        await mergeContactDetails(messages.msgData);

        if (mode == "replaceAll") {
          summary.subject =
            messages.msgData[messages.msgData.length - 1]?.subject;

          await dispatch(composeSlice.actions.resetStore());
          await dispatch(
            quickReplySlice.actions.setExpandedState({ expanded: false })
          );
          await dispatch(summaryActions.replaceSummaryDetails(summary));
        }

        await dispatch(messageActions.updateConversation({ messages, mode }));

        if (mode == "replaceAll") {
          if (loggingEnabled) {
            console.debug(
              "Load took (ms):",
              Date.now() - summary.loadingStartedTime
            );
          }
          // TODO: Fix this for the standalone message view, so that we send
          // the correct notifications.
          if (!state.summary.isInTab) {
            await browser.convMsgWindow.fireLoadCompleted();
          }
          await dispatch(summaryActions.maybeSetMarkAsRead());
        }
      });
    };
  },
};

globalThis.conversationControllerActions = controllerActions;
