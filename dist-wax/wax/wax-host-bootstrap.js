(function installMorphazoidWaxBootstrap(runtime, documentObject) {
  "use strict";

  if (!runtime || !documentObject) return;

  const bootstrapKey = Symbol.for("com.morphazoid.wax.bootstrap.v1");
  if (runtime[bootstrapKey]) return;

  const state = {
    callbackWasInvoked: false,
    commands: [],
    implementation: null,
    registrations: [],
    transportEvents: [],
    version: 1,
  };

  const detectCapabilities = () => {
    const dataTree = runtime.WAX_DataTree;
    const hasDataTree = Boolean(
      dataTree
      && typeof dataTree.pull === "function"
      && typeof dataTree.push === "function",
    );
    const hasPlayhead = Boolean(
      typeof runtime.WAX_RequestPlayheadInfo === "function"
      && typeof runtime.Request_PlayheadTimerStart === "function"
      && typeof runtime.Request_PlayheadTimerStop === "function",
    );

    return {
      dataTree: hasDataTree,
      midi: Boolean(runtime.navigator && typeof runtime.navigator.requestMIDIAccess === "function"),
      playhead: hasPlayhead,
      transport: state.callbackWasInvoked,
    };
  };

  const facade = {
    capabilities() {
      if (state.implementation) return state.implementation.capabilities();
      return detectCapabilities();
    },

    flush() {
      if (state.implementation) return state.implementation.flush();
      return Promise.resolve(false);
    },

    markDirty(source) {
      if (state.implementation) return state.implementation.markDirty(source);
      state.commands.push({ type: "markDirty", value: source });
      return false;
    },

    register(adapter) {
      if (state.implementation) return state.implementation.register(adapter);

      const pending = {
        active: true,
        adapter,
        unregister: null,
      };
      state.registrations.push(pending);

      return function unregisterPendingAdapter() {
        if (!pending.active) return;
        pending.active = false;
        if (typeof pending.unregister === "function") pending.unregister();
      };
    },

    requestPlayhead() {
      if (state.implementation) return state.implementation.requestPlayhead();
      return Promise.resolve(null);
    },
  };

  Object.defineProperty(facade, "detected", {
    configurable: false,
    enumerable: true,
    get() {
      if (state.implementation) return state.implementation.detected;
      const capabilities = detectCapabilities();
      return state.callbackWasInvoked || capabilities.dataTree || capabilities.playhead;
    },
  });

  state.facade = facade;
  state.detectCapabilities = detectCapabilities;
  runtime[bootstrapKey] = state;
  runtime.MorphazoidWAX = facade;

  const installTransportCallback = (name, type) => {
    const previous = typeof runtime[name] === "function" ? runtime[name] : null;
    runtime[name] = function morphazoidWaxTransportCallback(value) {
      state.callbackWasInvoked = true;

      if (previous) {
        try {
          previous.apply(this, arguments);
        } catch (error) {
          runtime.console?.error?.(`Morphazoid WAX: previous ${name} callback failed`, error);
        }
      }

      const event = { type, value };
      if (state.implementation) state.implementation.handleTransport(type, value);
      else state.transportEvents.push(event);
    };
  };

  installTransportCallback("WAX_Play", "play");
  installTransportCallback("WAX_Stop", "stop");
  installTransportCallback("WAX_BPM", "bpm");

  const scriptUrl = documentObject.currentScript?.src || documentObject.baseURI;
  const bridgeUrl = new URL("./wax-host-bridge.js", scriptUrl).href;

  import(bridgeUrl)
    .then((module) => module.installWaxHostBridge(runtime, state))
    .catch((error) => {
      runtime.console?.error?.("Morphazoid WAX: host bridge failed to load", error);
    });
}(window, document));
