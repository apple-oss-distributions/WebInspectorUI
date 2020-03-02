/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

WI.SourcesNavigationSidebarPanel = class SourcesNavigationSidebarPanel extends WI.NavigationSidebarPanel
{
    constructor()
    {
        const shouldAutoPruneStaleTopLevelResourceTreeElements = true;
        super("sources", WI.UIString("Sources"), shouldAutoPruneStaleTopLevelResourceTreeElements);

        this._workerTargetTreeElementMap = new Map;
        this._mainFrameTreeElement = null;
        this._extensionScriptsFolderTreeElement = null;
        this._extraScriptsFolderTreeElement = null;
        this._anonymousScriptsFolderTreeElement = null;

        this._originTreeElementMap = new Map;

        this._boundCompareTreeElements = this._compareTreeElements.bind(this);

        this._debuggerNavigationBar = new WI.NavigationBar;
        this.addSubview(this._debuggerNavigationBar);

        let createActivateNavigationItem = ({identifier, defaultToolTip, activatedToolTip, image}) => {
            let navigationItem = new WI.ActivateButtonNavigationItem(identifier, defaultToolTip, activatedToolTip, image, 15, 15);
            this._debuggerNavigationBar.addNavigationItem(navigationItem);
            return navigationItem;
        };

        let createToggleNavigationItem = ({identifier, defaultToolTip, alternateToolTip, defaultImage, alternateImage}) => {
            let navigationItem = new WI.ToggleButtonNavigationItem(identifier, defaultToolTip, alternateToolTip, defaultImage, alternateImage, 15, 15);
            this._debuggerNavigationBar.addNavigationItem(navigationItem);
            return navigationItem;
        };

        let createButtonNavigationitem = ({identifier, toolTipOrLabel, image}) => {
            let navigationItem = new WI.ButtonNavigationItem(identifier, toolTipOrLabel, image, 15, 15);
            this._debuggerNavigationBar.addNavigationItem(navigationItem);
            return navigationItem;
        };

        this._debuggerBreakpointsButtonItem = createActivateNavigationItem({
            identifier: "debugger-breakpoints",
            defaultToolTip: WI.UIString("Enable all breakpoints (%s)").format(WI.toggleBreakpointsKeyboardShortcut.displayName),
            activatedToolTip: WI.UIString("Disable all breakpoints (%s)").format(WI.toggleBreakpointsKeyboardShortcut.displayName),
            image: "Images/Breakpoints.svg",
        });
        this._debuggerBreakpointsButtonItem.activated = WI.debuggerManager.breakpointsEnabled;
        this._debuggerBreakpointsButtonItem.addEventListener(WI.ButtonNavigationItem.Event.Clicked, WI.debuggerToggleBreakpoints, this);

        this._debuggerPauseResumeButtonItem = createToggleNavigationItem({
            identifier: "debugger-pause-resume",
            defaultToolTip: WI.UIString("Pause script execution (%s or %s)").format(WI.pauseOrResumeKeyboardShortcut.displayName, WI.pauseOrResumeAlternateKeyboardShortcut.displayName),
            alternateToolTip: WI.UIString("Continue script execution (%s or %s)").format(WI.pauseOrResumeKeyboardShortcut.displayName, WI.pauseOrResumeAlternateKeyboardShortcut.displayName),
            defaultImage: "Images/Pause.svg",
            alternateImage: "Images/Resume.svg",
        });
        this._debuggerPauseResumeButtonItem.addEventListener(WI.ButtonNavigationItem.Event.Clicked, WI.debuggerPauseResumeToggle, this);

        this._debuggerStepOverButtonItem = createButtonNavigationitem({
            identifier: "debugger-step-over",
            toolTipOrLabel: WI.UIString("Step over (%s or %s)").format(WI.stepOverKeyboardShortcut.displayName, WI.stepOverAlternateKeyboardShortcut.displayName),
            image: "Images/StepOver.svg",
        });
        this._debuggerStepOverButtonItem.addEventListener(WI.ButtonNavigationItem.Event.Clicked, WI.debuggerStepOver, this);
        this._debuggerStepOverButtonItem.enabled = false;

        this._debuggerStepIntoButtonItem = createButtonNavigationitem({
            identifier: "debugger-step-into",
            toolTipOrLabel: WI.UIString("Step into (%s or %s)").format(WI.stepIntoKeyboardShortcut.displayName, WI.stepIntoAlternateKeyboardShortcut.displayName),
            image: "Images/StepInto.svg",
        });
        this._debuggerStepIntoButtonItem.addEventListener(WI.ButtonNavigationItem.Event.Clicked, WI.debuggerStepInto, this);
        this._debuggerStepIntoButtonItem.enabled = false;

        this._debuggerStepOutButtonItem = createButtonNavigationitem({
            identifier: "debugger-step-out",
            toolTipOrLabel: WI.UIString("Step out (%s or %s)").format(WI.stepOutKeyboardShortcut.displayName, WI.stepOutAlternateKeyboardShortcut.displayName),
            image: "Images/StepOut.svg",
        });
        this._debuggerStepOutButtonItem.addEventListener(WI.ButtonNavigationItem.Event.Clicked, WI.debuggerStepOut, this);
        this._debuggerStepOutButtonItem.enabled = false;

        this._timelineRecordingWarningElement = null;
        this._auditTestWarningElement = null;
        this._breakpointsDisabledWarningElement = null;

        this._pauseReasonTreeOutline = null;
        this._pauseReasonLinkContainerElement = document.createElement("span");
        this._pauseReasonTextRow = new WI.DetailsSectionTextRow;
        this._pauseReasonGroup = new WI.DetailsSectionGroup([this._pauseReasonTextRow]);
        this._pauseReasonSection = new WI.DetailsSection("paused-reason", WI.UIString("Pause Reason"), [this._pauseReasonGroup], this._pauseReasonLinkContainerElement);

        this._pauseReasonContainer = this.contentView.element.appendChild(document.createElement("div"));
        this._pauseReasonContainer.classList.add("pause-reason-container");
        this._pauseReasonContainer.hidden = true;
        this._pauseReasonContainer.appendChild(this._pauseReasonSection.element);

        this._callStackTreeOutline = this.createContentTreeOutline({suppressFiltering: true});
        this._callStackTreeOutline.addEventListener(WI.TreeOutline.Event.SelectionDidChange, this._handleTreeSelectionDidChange, this);

        let callStackRow = new WI.DetailsSectionRow;
        callStackRow.element.appendChild(this._callStackTreeOutline.element);

        let callStackGroup = new WI.DetailsSectionGroup([callStackRow]);
        this._callStackSection = new WI.DetailsSection("call-stack", WI.UIString("Call Stack"), [callStackGroup]);

        this._callStackContainer = this.contentView.element.appendChild(document.createElement("div"));
        this._callStackContainer.classList.add("call-stack-container");
        this._callStackContainer.hidden = true;
        this._callStackContainer.appendChild(this._callStackSection.element);

        this._mainTargetTreeElement = null;
        this._activeCallFrameTreeElement = null;

        // Prevent the breakpoints list from being used as the source of selection restoration (e.g. on reload or navigation).
        this._breakpointsTreeOutline = this.createContentTreeOutline({ignoreCookieRestoration: true});
        this._breakpointsTreeOutline.addEventListener(WI.TreeOutline.Event.ElementAdded, this._handleBreakpointElementAddedOrRemoved, this);
        this._breakpointsTreeOutline.addEventListener(WI.TreeOutline.Event.ElementRemoved, this._handleBreakpointElementAddedOrRemoved, this);
        this._breakpointsTreeOutline.addEventListener(WI.TreeOutline.Event.SelectionDidChange, this._handleTreeSelectionDidChange, this);
        this._breakpointsTreeOutline.ondelete = (selectedTreeElement) => {
            console.assert(selectedTreeElement.selected);

            if (!WI.debuggerManager.isBreakpointRemovable(selectedTreeElement.representedObject)) {
                let treeElementToSelect = selectedTreeElement.nextSelectableSibling;
                if (treeElementToSelect) {
                    const omitFocus = true;
                    const selectedByUser = true;
                    treeElementToSelect.select(omitFocus, selectedByUser);
                }
            } else if (selectedTreeElement instanceof WI.ResourceTreeElement || selectedTreeElement instanceof WI.ScriptTreeElement) {
                let breakpoints = this._breakpointsBeneathTreeElement(selectedTreeElement);
                this._removeAllBreakpoints(breakpoints);
            } else if (selectedTreeElement.representedObject === SourcesNavigationSidebarPanel.__windowEventTargetRepresentedObject) {
                let eventBreakpointsOnWindow = WI.domManager.eventListenerBreakpoints.filter((eventBreakpoint) => eventBreakpoint.eventListener.onWindow);
                for (let eventBreakpoint of eventBreakpointsOnWindow)
                    WI.domManager.removeBreakpointForEventListener(eventBreakpoint.eventListener);
            }

            return true;
        };
        this._breakpointsTreeOutline.populateContextMenu = (contextMenu, event, treeElement) => {
            // This check is necessary since the context menu is created by the TreeOutline, meaning
            // that any child could be the target of the context menu event.
            if (treeElement instanceof WI.ResourceTreeElement || treeElement instanceof WI.ScriptTreeElement) {
                let breakpoints = this._breakpointsBeneathTreeElement(treeElement);

                let shouldDisable = breakpoints.some((breakpoint) => !breakpoint.disabled);
                contextMenu.appendItem(shouldDisable ? WI.UIString("Disable Breakpoints") : WI.UIString("Enable Breakpoints"), () => {
                    this._toggleAllBreakpoints(breakpoints, shouldDisable);
                });

                contextMenu.appendItem(WI.UIString("Delete Breakpoints"), () => {
                    this._removeAllBreakpoints(breakpoints);
                });
            }

            WI.TreeOutline.prototype.populateContextMenu(contextMenu, event, treeElement);
        };

        let breakpointsRow = new WI.DetailsSectionRow;
        breakpointsRow.element.appendChild(this._breakpointsTreeOutline.element);

        let breakpointNavigationBarWrapper = document.createElement("div");

        let breakpointNavigationBar = new WI.NavigationBar;
        breakpointNavigationBarWrapper.appendChild(breakpointNavigationBar.element);

        this._createBreakpointButton = new WI.ButtonNavigationItem("create-breakpoint", WI.UIString("Create Breakpoint"), "Images/Plus13.svg", 13, 13);
        WI.addMouseDownContextMenuHandlers(this._createBreakpointButton.element, this._populateCreateBreakpointContextMenu.bind(this));
        breakpointNavigationBar.addNavigationItem(this._createBreakpointButton);

        let breakpointsGroup = new WI.DetailsSectionGroup([breakpointsRow]);
        this._breakpointsSection = new WI.DetailsSection("breakpoints", WI.UIString("Breakpoints"), [breakpointsGroup], breakpointNavigationBarWrapper);

        let breakpointsContainer = this.contentView.element.appendChild(document.createElement("div"));
        breakpointsContainer.classList.add("breakpoints-container");
        breakpointsContainer.appendChild(this._breakpointsSection.element);

        this._localOverridesTreeOutline = this.createContentTreeOutline({suppressFiltering: true});
        this._localOverridesTreeOutline.addEventListener(WI.TreeOutline.Event.SelectionDidChange, this._handleTreeSelectionDidChange, this);

        this._localOverridesRow = new WI.DetailsSectionRow(WI.UIString("No Overrides"));

        let localOverridesGroup = new WI.DetailsSectionGroup([this._localOverridesRow]);
        this._localOverridesSection = new WI.DetailsSection("local-overrides", WI.UIString("Local Overrides"), [localOverridesGroup]);

        this._localOverridesContainer = this.contentView.element.appendChild(document.createElement("div"));
        this._localOverridesContainer.classList.add("local-overrides-container");
        this._localOverridesContainer.hidden = true;
        this._localOverridesContainer.appendChild(this._localOverridesSection.element);

        this._resourcesNavigationBar = new WI.NavigationBar;
        this.contentView.addSubview(this._resourcesNavigationBar);

        this._resourceGroupingModeScopeBarItems = {};
        let createResourceGroupingModeScopeBarItem = (mode, label) => {
            this._resourceGroupingModeScopeBarItems[mode] = new WI.ScopeBarItem("sources-resource-grouping-mode-" + mode, label, {exclusive: true});
            this._resourceGroupingModeScopeBarItems[mode][SourcesNavigationSidebarPanel.ResourceGroupingModeSymbol] = mode;
        };
        createResourceGroupingModeScopeBarItem(WI.Resource.GroupingMode.Type, WI.UIString("By Type"));
        createResourceGroupingModeScopeBarItem(WI.Resource.GroupingMode.Path, WI.UIString("By Path"));

        this._resourceGroupingModeScopeBar = new WI.ScopeBar("sources-resource-grouping-mode-scope-bar", Object.values(this._resourceGroupingModeScopeBarItems), this._resourceGroupingModeScopeBarItems[WI.settings.resourceGroupingMode.value]);
        this._resourceGroupingModeScopeBar.addEventListener(WI.ScopeBar.Event.SelectionChanged, this._handleResourceGroupingModeScopeBarSelectionChanged, this);
        this._resourcesNavigationBar.addNavigationItem(this._resourceGroupingModeScopeBar);

        let resourcesContainer = this.contentView.element.appendChild(document.createElement("div"));
        resourcesContainer.classList.add("resources-container");

        this._resourcesTreeOutline = this.contentTreeOutline;
        this._resourcesTreeOutline.addEventListener(WI.TreeOutline.Event.SelectionDidChange, this._handleTreeSelectionDidChange, this);
        this._resourcesTreeOutline.includeSourceMapResourceChildren = true;
        resourcesContainer.appendChild(this._resourcesTreeOutline.element);

        if (WI.NetworkManager.supportsLocalResourceOverrides() || WI.NetworkManager.supportsBootstrapScript() || InspectorBackend.hasDomain("CSS")) {
            let createResourceNavigationBar = new WI.NavigationBar;

            let createResourceButtonNavigationItem = new WI.ButtonNavigationItem("create-resource", WI.UIString("Create Resource"), "Images/Plus15.svg", 15, 15);
            WI.addMouseDownContextMenuHandlers(createResourceButtonNavigationItem.element, this._populateCreateResourceContextMenu.bind(this));
            createResourceNavigationBar.addNavigationItem(createResourceButtonNavigationItem);

            this.filterBar.element.insertBefore(createResourceNavigationBar.element, this.filterBar.element.firstChild);
        }

        const activatedByDefault = false;
        this.filterBar.addFilterBarButton("sources-only-show-resources-with-issues", this._filterByResourcesWithIssues.bind(this), activatedByDefault, WI.UIString("Only show resources with issues"), WI.UIString("Show all resources"), "Images/Errors.svg", 15, 15);

        const resourceTypeScopeItemPrefix = "sources-resource-type-";
        let resourceTypeScopeBarItems = [];
        resourceTypeScopeBarItems.push(new WI.ScopeBarItem(resourceTypeScopeItemPrefix + "all", WI.UIString("All")));
        for (let value of Object.values(WI.Resource.Type)) {
            let scopeBarItem = new WI.ScopeBarItem(resourceTypeScopeItemPrefix + value, WI.Resource.displayNameForType(value, true));
            scopeBarItem[SourcesNavigationSidebarPanel.ResourceTypeSymbol] = value;
            resourceTypeScopeBarItems.push(scopeBarItem);
        }

        const shouldGroupNonExclusiveItems = true;
        this._resourceTypeScopeBar = new WI.ScopeBar("sources-resource-type-scope-bar", resourceTypeScopeBarItems, resourceTypeScopeBarItems[0], shouldGroupNonExclusiveItems);
        this._resourceTypeScopeBar.addEventListener(WI.ScopeBar.Event.SelectionChanged, this._handleResourceTypeScopeBarSelectionChanged, this);
        this.filterBar.addFilterNavigationItem(this._resourceTypeScopeBar);

        WI.settings.resourceGroupingMode.addEventListener(WI.Setting.Event.Changed, this._handleResourceGroupingModeChanged, this);

        WI.Frame.addEventListener(WI.Frame.Event.MainResourceDidChange, this._handleFrameMainResourceDidChange, this);
        WI.Frame.addEventListener(WI.Frame.Event.ResourceWasAdded, this._handleResourceAdded, this);
        WI.Target.addEventListener(WI.Target.Event.ResourceAdded, this._handleResourceAdded, this);

        WI.networkManager.addEventListener(WI.NetworkManager.Event.FrameWasAdded, this._handleFrameWasAdded, this);

        if (WI.NetworkManager.supportsBootstrapScript()) {
            WI.networkManager.addEventListener(WI.NetworkManager.Event.BootstrapScriptCreated, this._handleBootstrapScriptCreated, this);
            WI.networkManager.addEventListener(WI.NetworkManager.Event.BootstrapScriptDestroyed, this._handleBootstrapScriptDestroyed, this);
        }

        if (WI.NetworkManager.supportsLocalResourceOverrides()) {
            WI.networkManager.addEventListener(WI.NetworkManager.Event.LocalResourceOverrideAdded, this._handleLocalResourceOverrideAdded, this);
            WI.networkManager.addEventListener(WI.NetworkManager.Event.LocalResourceOverrideRemoved, this._handleLocalResourceOverrideRemoved, this);
        }

        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.BreakpointAdded, this._handleDebuggerBreakpointAdded, this);
        WI.domDebuggerManager.addEventListener(WI.DOMDebuggerManager.Event.DOMBreakpointAdded, this._handleDebuggerBreakpointAdded, this);
        WI.domDebuggerManager.addEventListener(WI.DOMDebuggerManager.Event.EventBreakpointAdded, this._handleDebuggerBreakpointAdded, this);
        WI.domDebuggerManager.addEventListener(WI.DOMDebuggerManager.Event.URLBreakpointAdded, this._handleDebuggerBreakpointAdded, this);

        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.BreakpointRemoved, this._handleDebuggerBreakpointRemoved, this);
        WI.domDebuggerManager.addEventListener(WI.DOMDebuggerManager.Event.DOMBreakpointRemoved, this._handleDebuggerBreakpointRemoved, this);
        WI.domDebuggerManager.addEventListener(WI.DOMDebuggerManager.Event.EventBreakpointRemoved, this._handleDebuggerBreakpointRemoved, this);
        WI.domDebuggerManager.addEventListener(WI.DOMDebuggerManager.Event.URLBreakpointRemoved, this._handleDebuggerBreakpointRemoved, this);

        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.BreakpointsEnabledDidChange, this._handleDebuggerBreakpointsEnabledDidChange, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.ScriptAdded, this._handleDebuggerScriptAdded, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.ScriptRemoved, this._handleDebuggerScriptRemoved, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.ScriptsCleared, this._handleDebuggerScriptsCleared, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.Paused, this._handleDebuggerPaused, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.Resumed, this._handleDebuggerResumed, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.CallFramesDidChange, this._handleDebuggerCallFramesDidChange, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.ActiveCallFrameDidChange, this._handleDebuggerActiveCallFrameDidChange, this);
        WI.debuggerManager.addEventListener(WI.DebuggerManager.Event.WaitingToPause, this._handleDebuggerWaitingToPause, this);

        WI.Breakpoint.addEventListener(WI.Breakpoint.Event.DisplayLocationDidChange, this._handleDebuggerObjectDisplayLocationDidChange, this);
        WI.IssueMessage.addEventListener(WI.IssueMessage.Event.DisplayLocationDidChange, this._handleDebuggerObjectDisplayLocationDidChange, this);

        WI.DOMBreakpoint.addEventListener(WI.DOMBreakpoint.Event.DOMNodeChanged, this._handleDOMBreakpointDOMNodeChanged, this);

        WI.consoleManager.addEventListener(WI.ConsoleManager.Event.IssueAdded, this._handleConsoleIssueAdded, this);
        WI.consoleManager.addEventListener(WI.ConsoleManager.Event.Cleared, this._handleConsoleCleared, this);

        WI.timelineManager.addEventListener(WI.TimelineManager.Event.CapturingStateChanged, this._handleTimelineCapturingStateChanged, this);

        WI.auditManager.addEventListener(WI.AuditManager.Event.TestScheduled, this._handleAuditManagerTestScheduled, this);
        WI.auditManager.addEventListener(WI.AuditManager.Event.TestCompleted, this._handleAuditManagerTestCompleted, this);

        WI.cssManager.addEventListener(WI.CSSManager.Event.StyleSheetAdded, this._handleCSSStyleSheetAdded, this);

        WI.targetManager.addEventListener(WI.TargetManager.Event.TargetAdded, this._handleTargetAdded, this);
        WI.targetManager.addEventListener(WI.TargetManager.Event.TargetRemoved, this._handleTargetRemoved, this);

        WI.notifications.addEventListener(WI.Notification.ExtraDomainsActivated, this._handleExtraDomainsActivated, this);

        if (WI.SourcesNavigationSidebarPanel.shouldPlaceResourcesAtTopLevel()) {
            this._resourcesTreeOutline.disclosureButtons = false;
            WI.SourceCode.addEventListener(WI.SourceCode.Event.SourceMapAdded, () => {
                this._resourcesTreeOutline.disclosureButtons = true;
            }, this);
        }

        WI.debuggerManager.addBreakpoint(WI.debuggerManager.allExceptionsBreakpoint);
        WI.debuggerManager.addBreakpoint(WI.debuggerManager.uncaughtExceptionsBreakpoint);

        // COMPATIBILITY (iOS 10): Debugger.setPauseOnAssertions did not exist yet.
        if (InspectorBackend.hasCommand("Debugger.setPauseOnAssertions") && WI.settings.showAssertionFailuresBreakpoint.value)
            WI.debuggerManager.addBreakpoint(WI.debuggerManager.assertionFailuresBreakpoint);

        // COMPATIBILITY (iOS 13): Debugger.setPauseOnMicrotasks did not exist yet.
        if (InspectorBackend.hasCommand("Debugger.setPauseOnMicrotasks") && WI.settings.showAllMicrotasksBreakpoint.value)
            WI.debuggerManager.addBreakpoint(WI.debuggerManager.allMicrotasksBreakpoint);

        for (let target of WI.targets)
            this._addTarget(target);

        this._updateCallStackTreeOutline();

        this._handleResourceGroupingModeChanged();

        if (WI.NetworkManager.supportsBootstrapScript()) {
            let bootstrapScript = WI.networkManager.bootstrapScript;
            if (bootstrapScript)
                this._addLocalOverride(bootstrapScript);
        }

        if (WI.NetworkManager.supportsLocalResourceOverrides()) {
            for (let localResourceOverride of WI.networkManager.localResourceOverrides)
                this._addLocalOverride(localResourceOverride);
        }

        if (WI.domDebuggerManager.supported) {
            if (WI.settings.showAllAnimationFramesBreakpoint.value)
                WI.domDebuggerManager.addEventBreakpoint(WI.domDebuggerManager.allAnimationFramesBreakpoint);

            if (WI.settings.showAllTimeoutsBreakpoint.value)
                WI.domDebuggerManager.addEventBreakpoint(WI.domDebuggerManager.allTimeoutsBreakpoint);

            if (WI.settings.showAllIntervalsBreakpoint.value)
                WI.domDebuggerManager.addEventBreakpoint(WI.domDebuggerManager.allIntervalsBreakpoint);

            if (WI.settings.showAllListenersBreakpoint.value)
                WI.domDebuggerManager.addEventBreakpoint(WI.domDebuggerManager.allListenersBreakpoint);

            for (let eventBreakpoint of WI.domDebuggerManager.listenerBreakpoints)
                this._addBreakpoint(eventBreakpoint);

            for (let eventListenerBreakpoint of WI.domManager.eventListenerBreakpoints)
                this._addBreakpoint(eventListenerBreakpoint);

            for (let domBreakpoint of WI.domDebuggerManager.domBreakpoints)
                this._addBreakpoint(domBreakpoint);

            if (WI.settings.showAllRequestsBreakpoint.value)
                WI.domDebuggerManager.addURLBreakpoint(WI.domDebuggerManager.allRequestsBreakpoint);

            for (let urlBreakpoints of WI.domDebuggerManager.urlBreakpoints)
                this._addBreakpoint(urlBreakpoints);
        }

        if (WI.debuggerManager.paused)
            this._handleDebuggerPaused();

        if (WI.debuggerManager.breakpointsDisabledTemporarily) {
            this._handleTimelineCapturingStateChanged();

            if (WI.auditManager.runningState === WI.AuditManager.RunningState.Active || WI.auditManager.runningState === WI.AuditManager.RunningState.Stopping)
                this._handleAuditManagerTestScheduled();
        }

        this._updateBreakpointsDisabledBanner();
    }

    // Static

    static shouldPlaceResourcesAtTopLevel()
    {
        return WI.sharedApp.debuggableType === WI.DebuggableType.JavaScript
            || WI.sharedApp.debuggableType === WI.DebuggableType.ServiceWorker;
    }

    // Public

    get minimumWidth()
    {
        return Math.max(this._debuggerNavigationBar.minimumWidth, this._resourcesNavigationBar.minimumWidth);
    }

    closed()
    {
        WI.settings.resourceGroupingMode.removeEventListener(null, null, this);
        WI.Frame.removeEventListener(null, null, this);
        WI.Target.removeEventListener(null, null, this);
        WI.networkManager.removeEventListener(null, null, this);
        WI.debuggerManager.removeEventListener(null, null, this);
        WI.domDebuggerManager.removeEventListener(null, null, this);
        WI.Breakpoint.removeEventListener(null, null, this);
        WI.IssueMessage.removeEventListener(null, null, this);
        WI.DOMBreakpoint.removeEventListener(null, null, this);
        WI.consoleManager.removeEventListener(null, null, this);
        WI.timelineManager.removeEventListener(null, null, this);
        WI.auditManager.removeEventListener(null, null, this);
        WI.cssManager.removeEventListener(null, null, this);
        WI.targetManager.removeEventListener(null, null, this);
        WI.notifications.removeEventListener(null, null, this);
        WI.SourceCode.removeEventListener(null, null, this);

        super.closed();
    }

    showDefaultContentView()
    {
        if (WI.networkManager.mainFrame) {
            this.contentBrowser.showContentViewForRepresentedObject(WI.networkManager.mainFrame);
            return;
        }

        let firstTreeElement = this._resourcesTreeOutline.children[0];
        if (firstTreeElement)
            this.showDefaultContentViewForTreeElement(firstTreeElement);
    }

    treeElementForRepresentedObject(representedObject)
    {
        // A custom implementation is needed for this since the frames are populated lazily.

        if (representedObject instanceof WI.LocalResourceOverride)
            return this._localOverridesTreeOutline.findTreeElement(representedObject);

        if (representedObject instanceof WI.LocalResource) {
            let localResourceOverride = WI.networkManager.localResourceOverrideForURL(representedObject.url);
            return this._localOverridesTreeOutline.findTreeElement(localResourceOverride);
        }

        if (representedObject instanceof WI.Script && representedObject === WI.networkManager.bootstrapScript)
            return this._localOverridesTreeOutline.findTreeElement(representedObject);

        if (!this._mainFrameTreeElement && (representedObject instanceof WI.Resource || representedObject instanceof WI.Frame || representedObject instanceof WI.Collection)) {
            // All resources are under the main frame, so we need to return early if we don't have the main frame yet.
            return null;
        }

        switch (WI.settings.resourceGroupingMode.value) {
        case WI.Resource.GroupingMode.Path:
            if (representedObject instanceof WI.Frame)
                representedObject = representedObject.mainResource;
            break;

        default:
            WI.reportInternalError("Unknown resource grouping mode", {"Resource Grouping Mode": WI.settings.resourceGroupingMode.value});
            // Fallthrough for default value.

        case WI.Resource.GroupingMode.Type:
            if (representedObject instanceof WI.Resource && representedObject.parentFrame && representedObject.parentFrame.mainResource === representedObject)
                representedObject = representedObject.parentFrame;
            break;
        }

        function isAncestor(ancestor, resourceOrFrame) {
            // SourceMapResources are descendants of another SourceCode object.
            if (resourceOrFrame instanceof WI.SourceMapResource) {
                if (resourceOrFrame.sourceMap.originalSourceCode === ancestor)
                    return true;

                // Not a direct ancestor, so check the ancestors of the parent SourceCode object.
                resourceOrFrame = resourceOrFrame.sourceMap.originalSourceCode;
            }

            let currentFrame = resourceOrFrame.parentFrame;
            while (currentFrame) {
                if (currentFrame === ancestor)
                    return true;
                currentFrame = currentFrame.parentFrame;
            }
            return false;
        }

        function getParent(resourceOrFrame) {
            // SourceMapResources are descendants of another SourceCode object.
            if (resourceOrFrame instanceof WI.SourceMapResource)
                return resourceOrFrame.sourceMap.originalSourceCode;
            return resourceOrFrame.parentFrame;
        }

        function searchTreeOutline(treeOutline, forceSearch) {
            if (!treeOutline || (!treeOutline.selectedTreeElement && !forceSearch))
                return null;
            return treeOutline.findTreeElement(representedObject, isAncestor, getParent);
        }
        let treeElement = searchTreeOutline(this._pauseReasonTreeOutline) || searchTreeOutline(this._callStackTreeOutline) || searchTreeOutline(this._breakpointsTreeOutline) || searchTreeOutline(this._resourcesTreeOutline, true);
        if (treeElement)
            return treeElement;

        // Only special case Script objects.
        if (!(representedObject instanceof WI.Script)) {
            console.error("Didn't find a TreeElement for representedObject", representedObject);
            return null;
        }

        // If the Script has a URL we should have found it earlier.
        if (representedObject.url) {
            console.error("Didn't find a ScriptTreeElement for a Script with a URL.");
            return null;
        }

        // Since the Script does not have a URL we consider it an 'anonymous' script. These scripts happen from calls to
        // window.eval() or browser features like Auto Fill and Reader. They are not normally added to the sidebar, but since
        // we have a ScriptContentView asking for the tree element we will make a ScriptTreeElement on demand and add it.

        if (!this._anonymousScriptsFolderTreeElement)
            this._anonymousScriptsFolderTreeElement = new WI.FolderTreeElement(WI.UIString("Anonymous Scripts"), new WI.ScriptCollection);

        if (!this._anonymousScriptsFolderTreeElement.parent) {
            let index = insertionIndexForObjectInListSortedByFunction(this._anonymousScriptsFolderTreeElement, this._resourcesTreeOutline.children, this._boundCompareTreeElements);
            this._resourcesTreeOutline.insertChild(this._anonymousScriptsFolderTreeElement, index);
        }

        this._anonymousScriptsFolderTreeElement.representedObject.add(representedObject);

        let scriptTreeElement = new WI.ScriptTreeElement(representedObject);
        this._anonymousScriptsFolderTreeElement.appendChild(scriptTreeElement);
        return scriptTreeElement;
    }

    // Protected

    createContentTreeOutline(options = {})
    {
        let treeOutline = super.createContentTreeOutline(options);

        treeOutline.addEventListener(WI.TreeOutline.Event.ElementRevealed, (event) => {
            let treeElement = event.data.element;
            let detailsSections = [this._pauseReasonSection, this._callStackSection, this._breakpointsSection, this._localOverridesSection];
            let detailsSection = detailsSections.find((detailsSection) => detailsSection.element.contains(treeElement.listItemElement));
            if (!detailsSection)
                return;

            // Revealing a TreeElement at the scroll container's topmost edge with
            // scrollIntoViewIfNeeded may result in the element being covered by the
            // DetailsSection header, which uses sticky positioning. Detect this case,
            // and adjust the sidebar content's scroll position to compensate.
            let offset = detailsSection.headerElement.totalOffsetBottom - treeElement.listItemElement.totalOffsetTop;
            if (offset > 0)
                this.scrollElement.scrollBy(0, -offset);
        });

        return treeOutline;
    }

    resetFilter()
    {
        this._resourceTypeScopeBar.resetToDefault();

        super.resetFilter();
    }

    hasCustomFilters()
    {
        console.assert(this._resourceTypeScopeBar.selectedItems.length === 1);
        let selectedScopeBarItem = this._resourceTypeScopeBar.selectedItems[0];
        return selectedScopeBarItem && selectedScopeBarItem !== this._resourceTypeScopeBar.defaultItem;
    }

    matchTreeElementAgainstCustomFilters(treeElement, flags)
    {
        // Only apply the resource type filter to the resources list.
        if (treeElement.treeOutline !== this._resourcesTreeOutline)
            return true;

        console.assert(this._resourceTypeScopeBar.selectedItems.length === 1);
        let selectedScopeBarItem = this._resourceTypeScopeBar.selectedItems[0];

        // Show everything if there is no selection or "All Resources" is selected (the default item).
        if (!selectedScopeBarItem || selectedScopeBarItem === this._resourceTypeScopeBar.defaultItem)
            return true;

        // Folders are hidden on the first pass, but visible childen under the folder will force the folder visible again.
        if (treeElement instanceof WI.FolderTreeElement || treeElement instanceof WI.OriginTreeElement)
            return false;

        if (treeElement instanceof WI.IssueTreeElement)
            treeElement = treeElement.parent;

        function match()
        {
            if (treeElement instanceof WI.FrameTreeElement)
                return selectedScopeBarItem[WI.SourcesNavigationSidebarPanel.ResourceTypeSymbol] === WI.Resource.Type.Document;

            if (treeElement instanceof WI.ScriptTreeElement)
                return selectedScopeBarItem[WI.SourcesNavigationSidebarPanel.ResourceTypeSymbol] === WI.Resource.Type.Script;

            if (treeElement instanceof WI.CSSStyleSheetTreeElement)
                return selectedScopeBarItem[WI.SourcesNavigationSidebarPanel.ResourceTypeSymbol] === WI.Resource.Type.StyleSheet;

            console.assert(treeElement instanceof WI.ResourceTreeElement, "Unknown treeElement", treeElement);
            if (!(treeElement instanceof WI.ResourceTreeElement))
                return false;

            return treeElement.resource.type === selectedScopeBarItem[WI.SourcesNavigationSidebarPanel.ResourceTypeSymbol];
        }

        let matched = match();
        if (matched)
            flags.expandTreeElement = true;
        return matched;
    }

    // Popover delegate

    willDismissPopover(popover)
    {
        if (popover instanceof WI.LocalResourceOverridePopover) {
            this._willDismissLocalOverridePopover(popover);
            return;
        }

        if (popover instanceof WI.EventBreakpointPopover) {
            this._willDismissEventBreakpointPopover(popover);
            return;
        }

        if (popover instanceof WI.URLBreakpointPopover) {
            this._willDismissURLBreakpointPopover(popover);
            return;
        }

        console.assert();
    }

    // Private

    _willDismissLocalOverridePopover(popover)
    {
        let serializedData = popover.serializedData;
        if (!serializedData) {
            if (!this._localOverridesTreeOutline.children.length)
                this._localOverridesContainer.hidden = true;

            InspectorFrontendHost.beep();
            return;
        }

        let {url, isCaseSensitive, isRegex, mimeType, statusCode, statusText, headers} = serializedData;

        // Do not conflict with an existing override.
        let existingOverride = WI.networkManager.localResourceOverrideForURL(url);
        if (existingOverride) {
            InspectorFrontendHost.beep();
            return;
        }

        let localResourceOverride = WI.LocalResourceOverride.create({
            url,
            isCaseSensitive,
            isRegex,
            mimeType,
            statusCode,
            statusText,
            headers,
            content: "",
            base64Encoded: false,
        });

        WI.networkManager.addLocalResourceOverride(localResourceOverride);
        WI.showLocalResourceOverride(localResourceOverride);
    }

    _willDismissEventBreakpointPopover(popover)
    {
        let breakpoint = popover.breakpoint;
        if (!breakpoint) {
            InspectorFrontendHost.beep();
            return;
        }

        if (!WI.domDebuggerManager.addEventBreakpoint(breakpoint))
            InspectorFrontendHost.beep();
    }

    _willDismissURLBreakpointPopover(popover)
    {
        let breakpoint = popover.breakpoint;
        if (!breakpoint) {
            InspectorFrontendHost.beep();
            return;
        }

        if (!WI.domDebuggerManager.addURLBreakpoint(breakpoint))
            InspectorFrontendHost.beep();
    }

    _filterByResourcesWithIssues(treeElement)
    {
        if (treeElement.treeOutline !== this._resourcesTreeOutline)
            return true;

        if (treeElement instanceof WI.IssueTreeElement)
            return true;

        if (treeElement.hasChildren) {
            for (let child of treeElement.children) {
                if (child instanceof WI.IssueTreeElement)
                    return true;
            }
        }
        return false;
    }

    _compareTreeElements(a, b)
    {
        const rankFunctions = [
            (treeElement) => treeElement instanceof WI.ScriptTreeElement && treeElement.representedObject === WI.networkManager.bootstrapScript,
            (treeElement) => treeElement instanceof WI.LocalResourceOverrideTreeElement,
            (treeElement) => treeElement instanceof WI.CSSStyleSheetTreeElement && treeElement.representedObject.isInspectorStyleSheet(),
            (treeElement) => treeElement === this._mainFrameTreeElement,
            (treeElement) => treeElement instanceof WI.FrameTreeElement,
            (treeElement) => treeElement instanceof WI.OriginTreeElement,
            (treeElement) => {
                return treeElement !== this._extensionScriptsFolderTreeElement
                    && treeElement !== this._extraScriptsFolderTreeElement
                    && treeElement !== this._anonymousScriptsFolderTreeElement;
            },
            (treeElement) => treeElement === this._extensionScriptsFolderTreeElement,
            (treeElement) => treeElement === this._extraScriptsFolderTreeElement,
            (treeElement) => treeElement === this._anonymousScriptsFolderTreeElement,
        ];

        let aRank = rankFunctions.findIndex((rankFunction) => rankFunction(a));
        let bRank = rankFunctions.findIndex((rankFunction) => rankFunction(b));
        if ((aRank >= 0 && bRank < 0) || aRank < bRank)
            return -1;
        if ((bRank >= 0 && aRank < 0) || bRank < aRank)
            return 1;

        return a.mainTitle.extendedLocaleCompare(b.mainTitle) || a.subtitle.extendedLocaleCompare(b.subtitle);
    }

    _closeContentViewsFilter(contentView)
    {
        // Local Resource Override content views do not need to be closed across page navigations.
        if (contentView.representedObject instanceof WI.LocalResource && contentView.representedObject.isLocalResourceOverride)
            return false;

        return true;
    }

    _updateMainFrameTreeElement(mainFrame)
    {
        if (this.didInitialLayout)
            this.contentBrowser.contentViewContainer.closeAllContentViews(this._closeContentViewsFilter);

        let oldMainFrameTreeElement = this._mainFrameTreeElement;
        if (this._mainFrameTreeElement) {
            this._resourcesTreeOutline.removeChild(this._mainFrameTreeElement);
            this._mainFrameTreeElement = null;
        }

        if (!mainFrame)
            return;

        switch (WI.settings.resourceGroupingMode.value) {
        case WI.Resource.GroupingMode.Path: {
            for (let treeElement of this._originTreeElementMap.values()) {
                if (treeElement !== oldMainFrameTreeElement)
                    this._resourcesTreeOutline.removeChild(treeElement);
            }
            this._originTreeElementMap.clear();

            let origin = mainFrame.urlComponents.origin;
            this._mainFrameTreeElement = new WI.OriginTreeElement(origin, mainFrame, {hasChildren: true});
            this._originTreeElementMap.set(origin, this._mainFrameTreeElement);
            break;
        }

        default:
            WI.reportInternalError("Unknown resource grouping mode", {"Resource Grouping Mode": WI.settings.resourceGroupingMode.value});
            // Fallthrough for default value.

        case WI.Resource.GroupingMode.Type:
            this._mainFrameTreeElement = new WI.FrameTreeElement(mainFrame);
            break;
        }

        this._resourcesTreeOutline.insertChild(this._mainFrameTreeElement, 0);

        // Cookie restoration will attempt to re-select the resource we were showing.
        // Give it time to do that before selecting the main frame resource.
        setTimeout(() => {
            if (this._resourcesTreeOutline.selectedTreeElement)
                return;

            let currentContentView = this.contentBrowser.currentContentView;
            let treeElement = currentContentView ? this.treeElementForRepresentedObject(currentContentView.representedObject) : null;
            if (!treeElement)
                treeElement = this.treeElementForRepresentedObject(WI.networkManager.mainFrame);
            this.showDefaultContentViewForTreeElement(treeElement);
        });
    }

    _addTarget(target)
    {
        let treeElement = new WI.ThreadTreeElement(target);
        this._callStackTreeOutline.appendChild(treeElement);

        // FIXME: When WI.mainTarget changes?
        if (target === WI.mainTarget)
            this._mainTargetTreeElement = treeElement;

        this._updateCallStackTreeOutline();
    }

    _findCallStackTargetTreeElement(target)
    {
        for (let child of this._callStackTreeOutline.children) {
            if (child.target === target)
                return child;
        }
        return null;
    }

    _updateCallStackTreeOutline()
    {
        let singleThreadShowing = WI.targets.length <= 1;
        this._callStackTreeOutline.element.classList.toggle("single-thread", singleThreadShowing);
        if (this._mainTargetTreeElement)
            this._mainTargetTreeElement.selectable = !singleThreadShowing;
    }

    _addResource(resource)
    {
        if (WI.settings.resourceGroupingMode.value === WI.Resource.GroupingMode.Path) {
            if (!this._mainFrameTreeElement || this._resourcesTreeOutline.findTreeElement(resource))
                return;

            let parentTreeElement = null;

            if (resource instanceof WI.CSSStyleSheet && resource.isInspectorStyleSheet())
                parentTreeElement = this._resourcesTreeOutline.findTreeElement(resource.parentFrame.mainResource);

            if (!parentTreeElement) {
                let origin = resource.urlComponents.origin;
                if (origin) {
                    let originTreeElement = this._originTreeElementMap.get(origin);
                    if (!originTreeElement) {
                        originTreeElement = new WI.OriginTreeElement(origin, resource.parentFrame, {hasChildren: true});
                        this._originTreeElementMap.set(origin, originTreeElement);

                        let index = insertionIndexForObjectInListSortedByFunction(originTreeElement, this._resourcesTreeOutline.children, this._boundCompareTreeElements);
                        this._resourcesTreeOutline.insertChild(originTreeElement, index);
                    }

                    let subpath = resource.urlComponents.path;
                    if (subpath && subpath[0] === "/")
                        subpath = subpath.substring(1);

                    parentTreeElement = originTreeElement.createFoldersAsNeededForSubpath(subpath, this._boundCompareTreeElements);
                } else
                    parentTreeElement = this._resourcesTreeOutline;
            }

            let resourceTreeElement = null;
            if (resource instanceof WI.CSSStyleSheet)
                resourceTreeElement = new WI.CSSStyleSheetTreeElement(resource);
            else
                resourceTreeElement = new WI.ResourceTreeElement(resource, resource, {allowDirectoryAsName: true, hideOrigin: true});

            let index = insertionIndexForObjectInListSortedByFunction(resourceTreeElement, parentTreeElement.children, this._boundCompareTreeElements);
            parentTreeElement.insertChild(resourceTreeElement, index);
        }

        if (resource.type === WI.Resource.Type.Document || resource.type === WI.Resource.Type.Script) {
            this._addBreakpointsForSourceCode(resource);
            this._addIssuesForSourceCode(resource);
        }
    }

    _addResourcesRecursivelyForFrame(frame)
    {
        this._addResource(frame.mainResource);

        for (let resource of frame.resourceCollection)
            this._addResource(resource);

        for (let childFrame of frame.childFrameCollection)
            this._addResourcesRecursivelyForFrame(childFrame);

        if (WI.settings.resourceGroupingMode.value === WI.Resource.GroupingMode.Path) {
            for (let styleSheet of WI.cssManager.inspectorStyleSheetsForFrame(frame))
                this._addResource(styleSheet);
        }
    }

    _addScript(script)
    {
        // We don't add scripts without URLs here. Those scripts can quickly clutter the interface and
        // are usually more transient. They will get added if/when they need to be shown in a content view.
        if (!script.url && !script.sourceURL)
            return;

        // Target main resource.
        if (WI.sharedApp.debuggableType !== WI.DebuggableType.JavaScript) {
            if (script.target !== WI.pageTarget) {
                if (script.isMainResource()) {
                    this._addWorkerTargetWithMainResource(script.target);
                    this._addBreakpointsForSourceCode(script);
                    this._addIssuesForSourceCode(script);
                }
                this._resourcesTreeOutline.disclosureButtons = true;
                return;
            }
        }

        // If the script URL matches a resource we can assume it is part of that resource and does not need added.
        if (script.resource || script.dynamicallyAddedScriptElement)
            return;

        let scriptTreeElement = new WI.ScriptTreeElement(script);

        if (!script.injected && WI.SourcesNavigationSidebarPanel.shouldPlaceResourcesAtTopLevel()) {
            let index = insertionIndexForObjectInListSortedByFunction(scriptTreeElement, this._resourcesTreeOutline.children, this._boundCompareTreeElements);
            this._resourcesTreeOutline.insertChild(scriptTreeElement, index);
        } else {
            let parentFolderTreeElement = null;

            if (script.injected) {
                if (!this._extensionScriptsFolderTreeElement) {
                    let collection = new WI.ScriptCollection;
                    this._extensionScriptsFolderTreeElement = new WI.FolderTreeElement(WI.UIString("Extension Scripts"), collection);
                }

                parentFolderTreeElement = this._extensionScriptsFolderTreeElement;
            } else {
                if (!this._extraScriptsFolderTreeElement) {
                    let collection = new WI.ScriptCollection;
                    this._extraScriptsFolderTreeElement = new WI.FolderTreeElement(WI.UIString("Extra Scripts"), collection);
                }

                parentFolderTreeElement = this._extraScriptsFolderTreeElement;
            }

            if (parentFolderTreeElement)
                parentFolderTreeElement.representedObject.add(script);

            if (!parentFolderTreeElement.parent) {
                let index = insertionIndexForObjectInListSortedByFunction(parentFolderTreeElement, this._resourcesTreeOutline.children, this._boundCompareTreeElements);
                this._resourcesTreeOutline.insertChild(parentFolderTreeElement, index);
            }

            parentFolderTreeElement.appendChild(scriptTreeElement);
        }

        this._addBreakpointsForSourceCode(script);
        this._addIssuesForSourceCode(script);
    }

    _addWorkerTargetWithMainResource(target)
    {
        console.assert(target.type === WI.TargetType.Worker || target.type === WI.TargetType.ServiceWorker);

        let targetTreeElement = new WI.WorkerTreeElement(target);
        this._workerTargetTreeElementMap.set(target, targetTreeElement);

        let index = insertionIndexForObjectInListSortedByFunction(targetTreeElement, this._resourcesTreeOutline.children, this._boundCompareTreeElements);
        this._resourcesTreeOutline.insertChild(targetTreeElement, index);
    }

    _addDebuggerTreeElementForSourceCode(sourceCode)
    {
        let treeElement = this._breakpointsTreeOutline.findTreeElement(sourceCode);
        if (!treeElement) {
            if (sourceCode instanceof WI.SourceMapResource)
                treeElement = new WI.SourceMapResourceTreeElement(sourceCode);
            else if (sourceCode instanceof WI.Resource)
                treeElement = new WI.ResourceTreeElement(sourceCode);
            else if (sourceCode instanceof WI.Script)
                treeElement = new WI.ScriptTreeElement(sourceCode);
        }

        if (!treeElement) {
            console.error("Unknown sourceCode instance", sourceCode);
            return null;
        }

        if (!treeElement.parent) {
            treeElement.hasChildren = false;
            treeElement.expand();

            this._insertDebuggerTreeElement(treeElement, this._breakpointsTreeOutline);
        }

        return treeElement;
    }

    _insertDebuggerTreeElement(treeElement, parentTreeElement)
    {
        let comparator = (a, b) => {
            const rankFunctions = [
                (treeElement) => treeElement.representedObject === WI.debuggerManager.allExceptionsBreakpoint,
                (treeElement) => treeElement.representedObject === WI.debuggerManager.uncaughtExceptionsBreakpoint,
                (treeElement) => treeElement.representedObject === WI.debuggerManager.assertionFailuresBreakpoint,
                (treeElement) => treeElement instanceof WI.BreakpointTreeElement || treeElement instanceof WI.ResourceTreeElement || treeElement instanceof WI.ScriptTreeElement,
                (treeElement) => treeElement.representedObject === WI.debuggerManager.allMicrotasksBreakpoint,
                (treeElement) => treeElement.representedObject === WI.domDebuggerManager.allAnimationFramesBreakpoint,
                (treeElement) => treeElement.representedObject === WI.domDebuggerManager.allTimeoutsBreakpoint,
                (treeElement) => treeElement.representedObject === WI.domDebuggerManager.allIntervalsBreakpoint,
                (treeElement) => treeElement.representedObject === WI.domDebuggerManager.allListenersBreakpoint,
                (treeElement) => treeElement instanceof WI.EventBreakpointTreeElement,
                (treeElement) => treeElement instanceof WI.DOMNodeTreeElement,
                (treeElement) => treeElement.representedObject === SourcesNavigationSidebarPanel.__windowEventTargetRepresentedObject,
                (treeElement) => treeElement instanceof WI.DOMBreakpointTreeElement,
                (treeElement) => treeElement.representedObject === WI.domDebuggerManager.allRequestsBreakpoint,
                (treeElement) => treeElement instanceof WI.URLBreakpointTreeElement,
            ];

            let aRank = rankFunctions.findIndex((rankFunction) => rankFunction(a));
            let bRank = rankFunctions.findIndex((rankFunction) => rankFunction(b));
            if (aRank >= 0 && bRank >= 0) {
                if (aRank < bRank)
                    return -1;
                if (bRank < aRank)
                    return 1;
            }

            if (a instanceof WI.BreakpointTreeElement && b instanceof WI.BreakpointTreeElement)
                return this._compareBreakpointTreeElements(a, b);

            return a.mainTitle.extendedLocaleCompare(b.mainTitle) || a.subtitle.extendedLocaleCompare(b.subtitle);
        };

        parentTreeElement.insertChild(treeElement, insertionIndexForObjectInListSortedByFunction(treeElement, parentTreeElement.children, comparator));
    }

    _compareBreakpointTreeElements(a, b)
    {
        if (!a.representedObject || !b.representedObject)
            return 0;

        let aLocation = a.representedObject.sourceCodeLocation;
        let bLocation = b.representedObject.sourceCodeLocation;
        if (!aLocation || !bLocation)
            return 0;

        return aLocation.displayLineNumber - bLocation.displayLineNumber || aLocation.displayColumnNumber - bLocation.displayColumnNumber;
    }

    _addBreakpoint(breakpoint)
    {
        if (this._breakpointsTreeOutline.findTreeElement(breakpoint))
            return null;

        let constructor = WI.BreakpointTreeElement;
        let options = {};
        let parentTreeElement = this._breakpointsTreeOutline;

        let getDOMNodeTreeElement = (domNode) => {
            console.assert(domNode, "Missing DOMNode for identifier", breakpoint.domNodeIdentifier);
            if (!domNode)
                return null;

            let domNodeTreeElement = this._breakpointsTreeOutline.findTreeElement(domNode);
            if (!domNodeTreeElement) {
                domNodeTreeElement = new WI.DOMNodeTreeElement(domNode);
                this._insertDebuggerTreeElement(domNodeTreeElement, this._breakpointsTreeOutline);
            }
            return domNodeTreeElement;
        };

        if (breakpoint === WI.debuggerManager.allExceptionsBreakpoint) {
            options.className = "breakpoint-exception-icon";
            options.title = WI.repeatedUIString.allExceptions();
        } else if (breakpoint === WI.debuggerManager.uncaughtExceptionsBreakpoint) {
            options.className = "breakpoint-exception-icon";
            options.title = WI.repeatedUIString.uncaughtExceptions();
        } else if (breakpoint === WI.debuggerManager.assertionFailuresBreakpoint) {
            options.className = "breakpoint-assertion-icon";
            options.title = WI.repeatedUIString.assertionFailures();
        } else if (breakpoint === WI.debuggerManager.allMicrotasksBreakpoint) {
            options.className = "breakpoint-microtask-icon";
            options.title = WI.UIString("All Microtasks");
        } else if (breakpoint instanceof WI.DOMBreakpoint) {
            if (!breakpoint.domNodeIdentifier)
                return null;

            constructor = WI.DOMBreakpointTreeElement;

            let domNode = WI.domManager.nodeForId(breakpoint.domNodeIdentifier);
            parentTreeElement = getDOMNodeTreeElement(domNode);
        } else if (breakpoint instanceof WI.EventBreakpoint) {
            constructor = WI.EventBreakpointTreeElement;

            if (breakpoint === WI.domDebuggerManager.allAnimationFramesBreakpoint)
                options.title = WI.UIString("All Animation Frames");
            else if (breakpoint === WI.domDebuggerManager.allIntervalsBreakpoint)
                options.title = WI.UIString("All Intervals");
            else if (breakpoint === WI.domDebuggerManager.allListenersBreakpoint)
                options.title = WI.UIString("All Events");
            else if (breakpoint === WI.domDebuggerManager.allTimeoutsBreakpoint)
                options.title = WI.UIString("All Timeouts");
            else if (breakpoint.eventListener) {
                let eventTargetTreeElement = null;
                if (breakpoint.eventListener.onWindow) {
                    if (!SourcesNavigationSidebarPanel.__windowEventTargetRepresentedObject)
                        SourcesNavigationSidebarPanel.__windowEventTargetRepresentedObject = {__window: true};

                    eventTargetTreeElement = this._breakpointsTreeOutline.findTreeElement(SourcesNavigationSidebarPanel.__windowEventTargetRepresentedObject);
                    if (!eventTargetTreeElement) {
                        const subtitle = null;
                        eventTargetTreeElement = new WI.GeneralTreeElement(["event-target-window"], WI.unlocalizedString("window"), subtitle, SourcesNavigationSidebarPanel.__windowEventTargetRepresentedObject);
                        this._insertDebuggerTreeElement(eventTargetTreeElement, this._breakpointsTreeOutline);
                    }
                } else if (breakpoint.eventListener.node)
                    eventTargetTreeElement = getDOMNodeTreeElement(breakpoint.eventListener.node);
                if (eventTargetTreeElement)
                    parentTreeElement = eventTargetTreeElement;
            }
        } else if (breakpoint instanceof WI.URLBreakpoint) {
            constructor = WI.URLBreakpointTreeElement;

            if (breakpoint === WI.domDebuggerManager.allRequestsBreakpoint)
                options.title = WI.repeatedUIString.allRequests();
        } else {
            let sourceCode = breakpoint.sourceCodeLocation && breakpoint.sourceCodeLocation.displaySourceCode;
            if (!sourceCode)
                return null;

            parentTreeElement = this._addDebuggerTreeElementForSourceCode(sourceCode);

            // Mark disabled breakpoints as resolved if there is source code loaded with that URL.
            // This gives the illusion the breakpoint was resolved, but since we don't send disabled
            // breakpoints to the backend we don't know for sure. If the user enables the breakpoint
            // it will be resolved properly.
            if (breakpoint.disabled)
                breakpoint.resolved = true;
        }

        let breakpointTreeElement = new constructor(breakpoint, options);
        this._insertDebuggerTreeElement(breakpointTreeElement, parentTreeElement);
        if (parentTreeElement.children.length === 1)
            parentTreeElement.expand();
        return breakpointTreeElement;
    }

    _removeBreakpoint(breakpoint)
    {
        if (this._pauseReasonTreeOutline) {
            let pauseReasonBreakpointTreeElement = this._pauseReasonTreeOutline.findTreeElement(breakpoint);
            if (pauseReasonBreakpointTreeElement)
                pauseReasonBreakpointTreeElement.status = null;
        }

        let breakpointTreeElement = this._breakpointsTreeOutline.findTreeElement(breakpoint);
        if (!breakpointTreeElement)
            return;

        this._removeDebuggerTreeElement(breakpointTreeElement);
    }

    _removeAllBreakpoints(breakpoints)
    {
        for (let breakpoint of breakpoints) {
            if (WI.debuggerManager.isBreakpointRemovable(breakpoint))
                WI.debuggerManager.removeBreakpoint(breakpoint);
        }
    }

    _toggleAllBreakpoints(breakpoints, disabled)
    {
        for (let breakpoint of breakpoints)
            breakpoint.disabled = disabled;
    }

    _breakpointsBeneathTreeElement(treeElement)
    {
        console.assert(treeElement instanceof WI.ResourceTreeElement || treeElement instanceof WI.ScriptTreeElement);
        if (!(treeElement instanceof WI.ResourceTreeElement) && !(treeElement instanceof WI.ScriptTreeElement))
            return [];

        let breakpoints = [];
        for (let child of treeElement.children) {
            console.assert(child instanceof WI.BreakpointTreeElement);
            let breakpoint = child.breakpoint;
            console.assert(breakpoint);
            if (breakpoint)
                breakpoints.push(breakpoint);
        }
        return breakpoints;
    }

    _addIssue(issueMessage, sourceCode)
    {
        let issueTreeElement = this._resourcesTreeOutline.findTreeElement(issueMessage);
        if (!issueTreeElement) {
            console.assert(sourceCode || (issueMessage.sourceCodeLocation && issueMessage.sourceCodeLocation.sourceCode));
            let parentTreeElement = this._resourcesTreeOutline.findTreeElement(sourceCode || issueMessage.sourceCodeLocation.sourceCode);
            if (!parentTreeElement)
                return null;

            issueTreeElement = new WI.IssueTreeElement(issueMessage);

            parentTreeElement.insertChild(issueTreeElement, insertionIndexForObjectInListSortedByFunction(issueTreeElement, parentTreeElement.children, this._compareBreakpointTreeElements));
            if (parentTreeElement.children.length === 1)
                parentTreeElement.expand();
        }
        return issueTreeElement;
    }

    _removeDebuggerTreeElement(debuggerTreeElement)
    {
        // If this is a BreakpointTreeElement being deleted because of a cause
        // outside of the TreeOutline then deselect if it is selected to avoid
        // TreeOutline selection changes causing unexpected ContentView changes.
        if (!debuggerTreeElement.__deletedViaDeleteKeyboardShortcut)
            debuggerTreeElement.deselect();

        let parentTreeElement = debuggerTreeElement.parent;
        parentTreeElement.removeChild(debuggerTreeElement);

        if (parentTreeElement.children.length || parentTreeElement === this._breakpointsTreeOutline)
            return;

        parentTreeElement.treeOutline.removeChild(parentTreeElement);
    }

    _addBreakpointsForSourceCode(sourceCode)
    {
        for (let breakpoint of WI.debuggerManager.breakpointsForSourceCode(sourceCode))
            this._addBreakpoint(breakpoint);
    }

    _addIssuesForSourceCode(sourceCode)
    {
        for (let issue of WI.consoleManager.issuesForSourceCode(sourceCode))
            this._addIssue(issue, sourceCode);
    }

    _addLocalOverride(localOverride)
    {
        console.assert(WI.NetworkManager.supportsBootstrapScript() || WI.NetworkManager.supportsLocalResourceOverrides());

        if (this._localOverridesTreeOutline.findTreeElement(localOverride))
            return;

        let parentTreeElement = this._localOverridesTreeOutline;

        let localOverrideTreeElement = null;
        if (localOverride === WI.networkManager.bootstrapScript)
            localOverrideTreeElement = new WI.BootstrapScriptTreeElement(localOverride);
        else if (localOverride instanceof WI.LocalResourceOverride)
            localOverrideTreeElement = new WI.LocalResourceOverrideTreeElement(localOverride.localResource, localOverride);
        console.assert(localOverrideTreeElement);

        let index = insertionIndexForObjectInListSortedByFunction(localOverrideTreeElement, parentTreeElement.children, this._boundCompareTreeElements);
        parentTreeElement.insertChild(localOverrideTreeElement, index);

        this._localOverridesRow.hideEmptyMessage();
        this._localOverridesRow.element.appendChild(this._localOverridesTreeOutline.element);
        this._localOverridesContainer.hidden = false;
    }

    _removeResourceOverride(localOverride)
    {
        console.assert(WI.NetworkManager.supportsBootstrapScript() || WI.NetworkManager.supportsLocalResourceOverrides());

        let resourceTreeElement = this._localOverridesTreeOutline.findTreeElement(localOverride);
        if (!resourceTreeElement)
            return;

        let wasSelected = resourceTreeElement.selected;

        let parentTreeElement = this._localOverridesTreeOutline;
        parentTreeElement.removeChild(resourceTreeElement);

        if (!parentTreeElement.children.length) {
            this._localOverridesContainer.hidden = true;

            if (wasSelected && WI.networkManager.mainFrame && WI.networkManager.mainFrame.mainResource)
                WI.showRepresentedObject(WI.networkManager.mainFrame.mainResource);
        }
    }

    _updateTemporarilyDisabledBreakpointsButtons()
    {
        let breakpointsDisabledTemporarily = WI.debuggerManager.breakpointsDisabledTemporarily;
        this._debuggerBreakpointsButtonItem.enabled = !breakpointsDisabledTemporarily;
        this._debuggerPauseResumeButtonItem.enabled = !breakpointsDisabledTemporarily;
    }

    _updateBreakpointsDisabledBanner()
    {
        if (!WI.debuggerManager.breakpointsEnabled && !this._timelineRecordingWarningElement && !this._auditTestWarningElement) {
            if (!this._breakpointsDisabledWarningElement) {
                let enableBreakpointsButton = document.createElement("button");
                enableBreakpointsButton.textContent = WI.UIString("Enable Breakpoints");
                enableBreakpointsButton.addEventListener("click", () => {
                    WI.debuggerToggleBreakpoints();
                });

                this._breakpointsDisabledWarningElement = document.createElement("div");
                this._breakpointsDisabledWarningElement.classList.add("warning-banner");
                this._breakpointsDisabledWarningElement.append(WI.UIString("Breakpoints disabled"), document.createElement("br"), enableBreakpointsButton);
            }

            this.contentView.element.insertBefore(this._breakpointsDisabledWarningElement, this.contentView.element.firstChild);
        } else if (this._breakpointsDisabledWarningElement) {
            this._breakpointsDisabledWarningElement.remove();
            this._breakpointsDisabledWarningElement = null;
        }
    }

    _updatePauseReason()
    {
        this._pauseReasonTreeOutline = null;

        this._updatePauseReasonGotoArrow();

        let target = WI.debuggerManager.activeCallFrame.target;
        let targetData = WI.debuggerManager.dataForTarget(target);
        return this._updatePauseReasonSection(target, targetData.pauseReason, targetData.pauseData);
    }

    _updatePauseReasonGotoArrow()
    {
        this._pauseReasonLinkContainerElement.removeChildren();

        let activeCallFrame = WI.debuggerManager.activeCallFrame;
        if (!activeCallFrame)
            return;

        let sourceCodeLocation = activeCallFrame.sourceCodeLocation;
        if (!sourceCodeLocation)
            return;

        const options = {
            useGoToArrowButton: true,
        };
        let linkElement = WI.createSourceCodeLocationLink(sourceCodeLocation, options);
        this._pauseReasonLinkContainerElement.appendChild(linkElement);
    }

    _updatePauseReasonSection(target, pauseReason, pauseData)
    {
        switch (pauseReason) {
        case WI.DebuggerManager.PauseReason.AnimationFrame: {
            this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});

            let eventBreakpointTreeElement = new WI.EventBreakpointTreeElement(WI.domDebuggerManager.allAnimationFramesBreakpoint, {
                className: "breakpoint-paused-icon",
                title: WI.UIString("requestAnimationFrame Fired"),
            });
            this._pauseReasonTreeOutline.appendChild(eventBreakpointTreeElement);

            let eventBreakpointRow = new WI.DetailsSectionRow;
            eventBreakpointRow.element.appendChild(this._pauseReasonTreeOutline.element);

            this._pauseReasonGroup.rows = [eventBreakpointRow];
            return true;
        }

        case WI.DebuggerManager.PauseReason.Assertion:
            // FIXME: We should include the assertion condition string.
            console.assert(pauseData, "Expected data with an assertion, but found none.");
            if (pauseData && pauseData.message)
                this._pauseReasonTextRow.text = WI.UIString("Assertion with message: %s").format(pauseData.message);
            else
                this._pauseReasonTextRow.text = WI.UIString("Assertion Failed");
            this._pauseReasonGroup.rows = [this._pauseReasonTextRow];
            return true;

        case WI.DebuggerManager.PauseReason.BlackboxedScript: {
            console.assert(pauseData);
            if (pauseData)
                this._updatePauseReasonSection(target, WI.DebuggerManager.pauseReasonFromPayload(pauseData.originalReason), pauseData.originalData);

            // Don't use `_pauseReasonTextRow` as it may have already been set.
            let blackboxReasonTextRow = new WI.DetailsSectionTextRow(WI.UIString("Deferred pause from blackboxed script"));
            blackboxReasonTextRow.__blackboxReason = true;

            let existingRows = this._pauseReasonGroup.rows.filter((row) => !row.__blackboxReason);
            this._pauseReasonGroup.rows = [blackboxReasonTextRow, ...existingRows];
            return true;
        }

        case WI.DebuggerManager.PauseReason.Breakpoint: {
            console.assert(pauseData, "Expected breakpoint identifier, but found none.");
            if (!pauseData || !pauseData.breakpointId)
                break;

            this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});
            this._pauseReasonTreeOutline.addEventListener(WI.TreeOutline.Event.SelectionDidChange, this._handleTreeSelectionDidChange, this);

            let breakpoint = WI.debuggerManager.breakpointForIdentifier(pauseData.breakpointId);
            let breakpointTreeElement = new WI.BreakpointTreeElement(breakpoint, {
                className: "breakpoint-paused-icon",
                title: WI.UIString("Triggered Breakpoint"),
            });
            let breakpointDetailsSection = new WI.DetailsSectionRow;
            this._pauseReasonTreeOutline.appendChild(breakpointTreeElement);
            breakpointDetailsSection.element.appendChild(this._pauseReasonTreeOutline.element);

            this._pauseReasonGroup.rows = [breakpointDetailsSection];
            return true;
        }

        case WI.DebuggerManager.PauseReason.CSPViolation:
            console.assert(pauseData, "Expected data with a CSP Violation, but found none.");
            if (!pauseData)
                break;

            // COMPATIBILITY (iOS 8): 'directive' was 'directiveText'.
            this._pauseReasonTextRow.text = WI.UIString("Content Security Policy violation of directive: %s").format(pauseData.directive || pauseData.directiveText);
            this._pauseReasonGroup.rows = [this._pauseReasonTextRow];
            return true;

        case WI.DebuggerManager.PauseReason.DebuggerStatement:
            this._pauseReasonTextRow.text = WI.UIString("Debugger Statement");
            this._pauseReasonGroup.rows = [this._pauseReasonTextRow];
            return true;

        case WI.DebuggerManager.PauseReason.DOM: {
            console.assert(WI.domDebuggerManager.supported);
            console.assert(pauseData, "Expected DOM breakpoint data, but found none.");
            if (!pauseData || !pauseData.nodeId)
                break;

            let domNode = WI.domManager.nodeForId(pauseData.nodeId);
            let domBreakpoints = WI.domDebuggerManager.domBreakpointsForNode(domNode);
            let domBreakpoint;
            for (let breakpoint of domBreakpoints) {
                if (breakpoint.type === pauseData.type) {
                    domBreakpoint = breakpoint;
                    break;
                }
            }

            console.assert(domBreakpoint, "Missing DOM breakpoint of type for node", pauseData.type, domNode);
            if (!domBreakpoint)
                break;

            this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});

            let type = WI.DOMBreakpointTreeElement.displayNameForType(domBreakpoint.type);
            let domBreakpointTreeElement = new WI.DOMBreakpointTreeElement(domBreakpoint, {
                className: "breakpoint-paused-icon",
                title: type,
            });
            let domBreakpointRow = new WI.DetailsSectionRow;
            this._pauseReasonTreeOutline.appendChild(domBreakpointTreeElement);
            domBreakpointRow.element.appendChild(this._pauseReasonTreeOutline.element);

            let ownerElementRow = new WI.DetailsSectionSimpleRow(WI.UIString("Element"), WI.linkifyNodeReference(domNode));
            this._pauseReasonGroup.rows = [domBreakpointRow, ownerElementRow];

            let updateTargetDescription = (nodeId) => {
                if (!nodeId)
                    return;

                let node = WI.domManager.nodeForId(nodeId);
                console.assert(node, "Missing node for id.", nodeId);
                if (!node)
                    return;

                let fragment = document.createDocumentFragment();

                let description = null;
                switch (domBreakpoint.type) {
                case WI.DOMBreakpoint.Type.SubtreeModified:
                    description = pauseData.insertion ? WI.UIString("Child added to ") : WI.UIString("Removed descendant ");
                    break;
                case WI.DOMBreakpoint.Type.NodeRemoved:
                    description = WI.UIString("Removed ancestor ");
                    break;
                }
                console.assert(description);
                fragment.append(description, WI.linkifyNodeReference(node));

                let targetDescriptionRow = new WI.DetailsSectionSimpleRow(WI.UIString("Details"), fragment);
                targetDescriptionRow.element.classList.add("target-description");

                this._pauseReasonGroup.rows = this._pauseReasonGroup.rows.concat(targetDescriptionRow);
            };

            if (pauseData.targetNodeId) {
                console.assert(domBreakpoint.type === WI.DOMBreakpoint.Type.SubtreeModified || domBreakpoint.type === WI.DOMBreakpoint.Type.NodeRemoved);
                updateTargetDescription(pauseData.targetNodeId);
            } else if (pauseData.targetNode) { // COMPATIBILITY (iOS 13): `targetNode` was renamed to `targetNodeId` and was changed from a `Runtime.RemoteObject` to a `DOM.NodeId`.
                console.assert(domBreakpoint.type === WI.DOMBreakpoint.Type.SubtreeModified);
                let remoteObject = WI.RemoteObject.fromPayload(pauseData.targetNode, target);
                remoteObject.pushNodeToFrontend(updateTargetDescription);
            }

            return true;
        }

        case WI.DebuggerManager.PauseReason.Listener:
        case WI.DebuggerManager.PauseReason.EventListener: {
            console.assert(pauseData, "Expected data with an event listener, but found none.");
            if (!pauseData)
                break;

            let eventBreakpoint = null;
            if (pauseData.eventListenerId)
                eventBreakpoint = WI.domManager.breakpointForEventListenerId(pauseData.eventListenerId);
            if (!eventBreakpoint)
                eventBreakpoint = WI.domDebuggerManager.listenerBreakpointForEventName(pauseData.eventName);

            console.assert(eventBreakpoint, "Expected Event Listener breakpoint for event name.", pauseData.eventName);
            if (!eventBreakpoint)
                break;

            this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});

            let eventBreakpointTreeElement = new WI.EventBreakpointTreeElement(eventBreakpoint, {
                className: "breakpoint-paused-icon",
                title: WI.UIString("\u201C%s\u201D Event Fired").format(pauseData.eventName),
            });
            this._pauseReasonTreeOutline.appendChild(eventBreakpointTreeElement);

            let eventBreakpointRow = new WI.DetailsSectionRow;
            eventBreakpointRow.element.appendChild(this._pauseReasonTreeOutline.element);

            let rows = [eventBreakpointRow];

            let eventListener = eventBreakpoint.eventListener;
            if (eventListener) {
                console.assert(eventListener.eventListenerId === pauseData.eventListenerId);

                let value = null;
                if (eventListener.onWindow)
                    value = WI.unlocalizedString("window");
                else if (eventListener.node)
                    value = WI.linkifyNodeReference(eventListener.node);
                if (value)
                    rows.push(new WI.DetailsSectionSimpleRow(WI.UIString("Target"), value));
            }

            this._pauseReasonGroup.rows = rows;
            return true;
        }

        case WI.DebuggerManager.PauseReason.Exception: {
            console.assert(pauseData, "Expected data with an exception, but found none.");
            if (!pauseData)
                break;

            // FIXME: We should improve the appearance of thrown objects. This works well for exception strings.
            let data = WI.RemoteObject.fromPayload(pauseData, target);
            this._pauseReasonTextRow.text = WI.UIString("Exception with thrown value: %s").format(data.description);
            this._pauseReasonGroup.rows = [this._pauseReasonTextRow];
            return true;
        }

        case WI.DebuggerManager.PauseReason.Interval: {
            this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});

            let eventBreakpointTreeElement = new WI.EventBreakpointTreeElement(WI.domDebuggerManager.allIntervalsBreakpoint, {
                className: "breakpoint-paused-icon",
                title: WI.UIString("setInterval Fired"),
            });
            this._pauseReasonTreeOutline.appendChild(eventBreakpointTreeElement);

            let eventBreakpointRow = new WI.DetailsSectionRow;
            eventBreakpointRow.element.appendChild(this._pauseReasonTreeOutline.element);

            this._pauseReasonGroup.rows = [eventBreakpointRow];
            return true;
        }

        case WI.DebuggerManager.PauseReason.Microtask:
            this._pauseReasonTextRow.text = WI.UIString("Microtask Fired");
            this._pauseReasonGroup.rows = [this._pauseReasonTextRow];
            return true;

        case WI.DebuggerManager.PauseReason.PauseOnNextStatement:
            this._pauseReasonTextRow.text = WI.UIString("Immediate Pause Requested");
            this._pauseReasonGroup.rows = [this._pauseReasonTextRow];
            return true;

        case WI.DebuggerManager.PauseReason.Timer: {
            console.assert(pauseData, "Expected data with a timer, but found none.");
            if (!pauseData)
                break;

            let eventBreakpoint = null;
            switch (pauseData.eventName) {
            case "setTimeout":
                eventBreakpoint = WI.domDebuggerManager.allTimeoutsBreakpoint;
                break;

            case "setInterval":
                eventBreakpoint = WI.domDebuggerManager.allIntervalsBreakpoint;
                break;
            }
            console.assert(eventBreakpoint, "Expected Timer breakpoint for event name.", pauseData.eventName);
            if (!eventBreakpoint)
                break;

            this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});

            let eventBreakpointTreeElement = new WI.EventBreakpointTreeElement(eventBreakpoint, {
                className: "breakpoint-paused-icon",
                title: WI.UIString("%s Fired").format(pauseData.eventName),
            });
            this._pauseReasonTreeOutline.appendChild(eventBreakpointTreeElement);

            let eventBreakpointRow = new WI.DetailsSectionRow;
            eventBreakpointRow.element.appendChild(this._pauseReasonTreeOutline.element);

            this._pauseReasonGroup.rows = [eventBreakpointRow];
            return true;
        }

        case WI.DebuggerManager.PauseReason.Timeout: {
            this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});

            let eventBreakpointTreeElement = new WI.EventBreakpointTreeElement(WI.domDebuggerManager.allTimeoutsBreakpoint, {
                className: "breakpoint-paused-icon",
                title: WI.UIString("setTimeout Fired"),
            });
            this._pauseReasonTreeOutline.appendChild(eventBreakpointTreeElement);

            let eventBreakpointRow = new WI.DetailsSectionRow;
            eventBreakpointRow.element.appendChild(this._pauseReasonTreeOutline.element);

            this._pauseReasonGroup.rows = [eventBreakpointRow];
            return true;
        }

        case WI.DebuggerManager.PauseReason.Fetch:
        case WI.DebuggerManager.PauseReason.XHR: {
            console.assert(WI.domDebuggerManager.supported);
            console.assert(pauseData, "Expected URL breakpoint data, but found none.");
            if (!pauseData)
                break;

            if (pauseData.breakpointURL) {
                let urlBreakpoint = WI.domDebuggerManager.urlBreakpointForURL(pauseData.breakpointURL);
                console.assert(urlBreakpoint, "Expected URL breakpoint for URL.", pauseData.breakpointURL);

                this._pauseReasonTreeOutline = this.createContentTreeOutline({suppressFiltering: true});

                let urlBreakpointTreeElement = new WI.URLBreakpointTreeElement(urlBreakpoint, {
                    className: "breakpoint-paused-icon",
                    title: WI.UIString("Triggered URL Breakpoint"),
                });
                let urlBreakpointRow = new WI.DetailsSectionRow;
                this._pauseReasonTreeOutline.appendChild(urlBreakpointTreeElement);
                urlBreakpointRow.element.appendChild(this._pauseReasonTreeOutline.element);

                this._pauseReasonTextRow.text = pauseData.url;
                this._pauseReasonGroup.rows = [urlBreakpointRow, this._pauseReasonTextRow];
            } else {
                console.assert(pauseData.breakpointURL === "", "Should be the All Requests breakpoint which has an empty URL");
                this._pauseReasonTextRow.text = WI.UIString("Requesting: %s").format(pauseData.url);
                this._pauseReasonGroup.rows = [this._pauseReasonTextRow];
            }
            this._pauseReasonTextRow.element.title = pauseData.url;
            return true;
        }

        case WI.DebuggerManager.PauseReason.Other:
            console.error("Paused for unknown reason. We should always have a reason.");
            break;
        }

        return false;
    }

    _handleResourceGroupingModeScopeBarSelectionChanged(event)
    {
        console.assert(this._resourceGroupingModeScopeBar.selectedItems.length === 1);
        let selectedScopeBarItem = this._resourceGroupingModeScopeBar.selectedItems[0];
        WI.settings.resourceGroupingMode.value = selectedScopeBarItem[SourcesNavigationSidebarPanel.ResourceGroupingModeSymbol] || WI.Resource.GroupingMode.Type;
    }

    _handleResourceTypeScopeBarSelectionChanged(event)
    {
        this.updateFilter();
    }

    _handleTreeSelectionDidChange(event)
    {
        if (!this.selected)
            return;

        let treeElement = event.target.selectedTreeElement;
        if (!treeElement)
            return;

        if (treeElement instanceof WI.DOMNodeTreeElement
            || treeElement instanceof WI.DOMBreakpointTreeElement
            || treeElement instanceof WI.EventBreakpointTreeElement
            || treeElement instanceof WI.URLBreakpointTreeElement)
            return;

        if (treeElement.representedObject === SourcesNavigationSidebarPanel.__windowEventTargetRepresentedObject)
            return;

        if (treeElement instanceof WI.LocalResourceOverrideTreeElement) {
            WI.showRepresentedObject(treeElement.representedObject.localResource);
            return;
        }

        // Silently select the corresponding tree element in the resources tree outline to update
        // the hierarchical path components to show the right ancestor(s).
        let selectTreeElementInResourcesTreeOutline = (sourceCode) => {
            let resourceTreeElement = this._resourcesTreeOutline.findTreeElement(sourceCode);
            if (!resourceTreeElement)
                return;

            const omitFocus = true;
            const selectedByUser = false;
            const suppressNotification = true;
            resourceTreeElement.select(omitFocus, selectedByUser, suppressNotification);
        };

        if (treeElement instanceof WI.FolderTreeElement
            || treeElement instanceof WI.OriginTreeElement
            || treeElement instanceof WI.ResourceTreeElement
            || treeElement instanceof WI.ScriptTreeElement
            || treeElement instanceof WI.CSSStyleSheetTreeElement) {
            let representedObject = treeElement.representedObject;

            if (representedObject instanceof WI.Script && representedObject.resource)
                representedObject = representedObject.resource;

            if (treeElement.treeOutline !== this._resourcesTreeOutline)
                selectTreeElementInResourcesTreeOutline(representedObject);

            if (representedObject instanceof WI.Collection || representedObject instanceof WI.SourceCode || representedObject instanceof WI.Frame)
                WI.showRepresentedObject(representedObject);
            return;
        }

        if (treeElement instanceof WI.CallFrameTreeElement) {
            let callFrame = treeElement.callFrame;
            if (callFrame.id)
                WI.debuggerManager.activeCallFrame = callFrame;
            if (callFrame.sourceCodeLocation)
                WI.showSourceCodeLocation(callFrame.sourceCodeLocation);
            return;
        }

        if (treeElement instanceof WI.IssueTreeElement) {
            WI.showSourceCodeLocation(treeElement.issueMessage.sourceCodeLocation);
            return;
        }

        if (treeElement instanceof WI.BreakpointTreeElement) {
            let breakpoint = treeElement.breakpoint;
            if (WI.debuggerManager.isBreakpointSpecial(breakpoint))
                return;

            let sourceCode = breakpoint.sourceCodeLocation.displaySourceCode;
            if (sourceCode instanceof WI.Script && sourceCode.resource)
                sourceCode = sourceCode.resource;
            selectTreeElementInResourcesTreeOutline(sourceCode);

            WI.showSourceCodeLocation(breakpoint.sourceCodeLocation);
            return;
        }

        console.error("Unknown tree element", treeElement);
    }

    _handleBreakpointElementAddedOrRemoved(event)
    {
        let treeElement = event.data.element;

        let setting = null;
        switch (treeElement.representedObject) {
        case WI.debuggerManager.assertionFailuresBreakpoint:
            setting = WI.settings.showAssertionFailuresBreakpoint;
            break;

        case WI.debuggerManager.allMicrotasksBreakpoint:
            setting = WI.settings.showAllMicrotasksBreakpoint;
            break;

        case WI.domDebuggerManager.allAnimationFramesBreakpoint:
            setting = WI.settings.showAllAnimationFramesBreakpoint;
            break;

        case WI.domDebuggerManager.allIntervalsBreakpoint:
            setting = WI.settings.showAllIntervalsBreakpoint;
            break;

        case WI.domDebuggerManager.allListenersBreakpoint:
            setting = WI.settings.showAllListenersBreakpoint;
            break;

        case WI.domDebuggerManager.allRequestsBreakpoint:
            setting = WI.settings.showAllRequestsBreakpoint;
            break;

        case WI.domDebuggerManager.allTimeoutsBreakpoint:
            setting = WI.settings.showAllTimeoutsBreakpoint;
            break;
        }

        if (setting)
            setting.value = !!treeElement.parent;

        if (event.type === WI.TreeOutline.Event.ElementRemoved) {
            let selectedTreeElement = this._breakpointsTreeOutline.selectedTreeElement;
            if (selectedTreeElement) {
                if (selectedTreeElement.representedObject === WI.debuggerManager.assertionFailuresBreakpoint || !WI.debuggerManager.isBreakpointRemovable(selectedTreeElement.representedObject)) {
                    const skipUnrevealed = true;
                    const dontPopulate = true;
                    let treeElementToSelect = selectedTreeElement.traverseNextTreeElement(skipUnrevealed, dontPopulate);
                    if (treeElementToSelect) {
                        const omitFocus = true;
                        const selectedByUser = true;
                        treeElementToSelect.select(omitFocus, selectedByUser);
                    }
                }
            }
        }
    }

    _populateCreateBreakpointContextMenu(contextMenu)
    {
        // COMPATIBILITY (iOS 10): Debugger.setPauseOnAssertions did not exist yet.
        if (InspectorBackend.hasCommand("Debugger.setPauseOnAssertions")) {
            let assertionFailuresBreakpointShown = WI.settings.showAssertionFailuresBreakpoint.value;

            contextMenu.appendCheckboxItem(WI.repeatedUIString.assertionFailures(), () => {
                if (assertionFailuresBreakpointShown)
                    WI.debuggerManager.removeBreakpoint(WI.debuggerManager.assertionFailuresBreakpoint);
                else {
                    WI.debuggerManager.assertionFailuresBreakpoint.disabled = false;
                    WI.debuggerManager.addBreakpoint(WI.debuggerManager.assertionFailuresBreakpoint);
                }
            }, assertionFailuresBreakpointShown);
        }

        contextMenu.appendSeparator();

        // COMPATIBILITY (iOS 13): Debugger.setPauseOnMicrotasks did not exist yet.
        if (InspectorBackend.hasCommand("Debugger.setPauseOnMicrotasks")) {
            let allMicrotasksBreakpointShown = WI.settings.showAllMicrotasksBreakpoint.value;

            contextMenu.appendCheckboxItem(WI.UIString("All Microtasks"), () => {
                if (allMicrotasksBreakpointShown)
                    WI.debuggerManager.removeBreakpoint(WI.debuggerManager.allMicrotasksBreakpoint);
                else {
                    WI.debuggerManager.allMicrotasksBreakpoint.disabled = false;
                    WI.debuggerManager.addBreakpoint(WI.debuggerManager.allMicrotasksBreakpoint);
                }
            }, allMicrotasksBreakpointShown);
        }

        if (WI.DOMDebuggerManager.supportsEventBreakpoints() || WI.DOMDebuggerManager.supportsEventListenerBreakpoints()) {
            function addToggleForSpecialEventBreakpoint(breakpoint, label, checked) {
                contextMenu.appendCheckboxItem(label, () => {
                    if (checked)
                        WI.domDebuggerManager.removeEventBreakpoint(breakpoint);
                    else {
                        breakpoint.disabled = false;
                        WI.domDebuggerManager.addEventBreakpoint(breakpoint);
                    }
                }, checked);
            }

            addToggleForSpecialEventBreakpoint(WI.domDebuggerManager.allAnimationFramesBreakpoint, WI.UIString("All Animation Frames"), WI.settings.showAllAnimationFramesBreakpoint.value);
            addToggleForSpecialEventBreakpoint(WI.domDebuggerManager.allTimeoutsBreakpoint, WI.UIString("All Timeouts"), WI.settings.showAllTimeoutsBreakpoint.value);
            addToggleForSpecialEventBreakpoint(WI.domDebuggerManager.allIntervalsBreakpoint, WI.UIString("All Intervals"), WI.settings.showAllIntervalsBreakpoint.value);

            contextMenu.appendSeparator();

            if (WI.DOMDebuggerManager.supportsAllListenersBreakpoint())
                addToggleForSpecialEventBreakpoint(WI.domDebuggerManager.allListenersBreakpoint, WI.UIString("All Events"), WI.settings.showAllListenersBreakpoint.value);

            contextMenu.appendItem(WI.UIString("Event Breakpoint\u2026"), () => {
                let popover = new WI.EventBreakpointPopover(this);
                popover.show(this._createBreakpointButton.element, [WI.RectEdge.MAX_Y, WI.RectEdge.MIN_Y, WI.RectEdge.MAX_X]);
            });
        }

        if (WI.DOMDebuggerManager.supportsURLBreakpoints() || WI.DOMDebuggerManager.supportsXHRBreakpoints()) {
            contextMenu.appendSeparator();

            let allRequestsBreakpointShown = WI.settings.showAllRequestsBreakpoint.value;
            contextMenu.appendCheckboxItem(WI.repeatedUIString.allRequests(), () => {
                if (allRequestsBreakpointShown)
                    WI.domDebuggerManager.removeURLBreakpoint(WI.domDebuggerManager.allRequestsBreakpoint);
                else {
                    WI.domDebuggerManager.allRequestsBreakpoint.disabled = false;
                    WI.domDebuggerManager.addURLBreakpoint(WI.domDebuggerManager.allRequestsBreakpoint);
                }
            }, allRequestsBreakpointShown);

            contextMenu.appendItem(WI.DOMDebuggerManager.supportsURLBreakpoints() ? WI.UIString("URL Breakpoint\u2026") : WI.UIString("XHR Breakpoint\u2026"), () => {
                let popover = new WI.URLBreakpointPopover(this);
                popover.show(this._createBreakpointButton.element, [WI.RectEdge.MAX_Y, WI.RectEdge.MIN_Y, WI.RectEdge.MAX_X]);
            });
        }
    }

    _populateCreateResourceContextMenu(contextMenu)
    {
        if (WI.NetworkManager.supportsLocalResourceOverrides()) {
            contextMenu.appendItem(WI.UIString("Local Override\u2026"), () => {
                if (!this._localOverridesTreeOutline.children.length)
                    this._localOverridesRow.showEmptyMessage();

                this._localOverridesContainer.hidden = false;

                this._localOverridesSection.titleElement.scrollIntoViewIfNeeded(false);
                requestAnimationFrame(() => {
                    let popover = new WI.LocalResourceOverridePopover(this);
                    popover.show(null, this._localOverridesSection.titleElement, [WI.RectEdge.MAX_Y, WI.RectEdge.MIN_Y, WI.RectEdge.MAX_X]);
                });
            });
        }

        if (WI.NetworkManager.supportsBootstrapScript()) {
            contextMenu.appendItem(WI.UIString("Inspector Bootstrap Script"), async () => {
                await WI.networkManager.createBootstrapScript();
                WI.networkManager.bootstrapScriptEnabled = true;
                WI.showRepresentedObject(WI.networkManager.bootstrapScript);
            });
        }

        if (InspectorBackend.hasDomain("CSS")) {
            let addInspectorStyleSheetItem = (menu, frame) => {
                menu.appendItem(WI.UIString("Inspector Style Sheet"), () => {
                    if (WI.settings.resourceGroupingMode.value === WI.Resource.GroupingMode.Path) {
                        // Force the parent to populate.
                        let parentFrameTreeElement = this._resourcesTreeOutline.findTreeElement(frame.mainResource);
                        parentFrameTreeElement.reveal();
                        parentFrameTreeElement.expand();
                    }

                    WI.cssManager.preferredInspectorStyleSheetForFrame(frame, (styleSheet) => {
                        WI.showRepresentedObject(styleSheet);
                    });
                });
            };

            addInspectorStyleSheetItem(contextMenu, WI.networkManager.mainFrame);

            let frames = WI.networkManager.frames;
            if (frames.length > 2) {
                let framesSubMenu = contextMenu.appendSubMenuItem(WI.UIString("Frames"));

                for (let frame of frames) {
                    if (frame === WI.networkManager.mainFrame || frame.mainResource.type !== WI.Resource.Type.Document)
                        continue;

                    let frameSubMenuItem = framesSubMenu.appendSubMenuItem(frame.name ? WI.UIString("%s (%s)").format(frame.name, frame.mainResource.displayName) : frame.mainResource.displayName);

                    addInspectorStyleSheetItem(frameSubMenuItem, frame);
                }
            }
        }
    }

    _handleResourceGroupingModeChanged(event)
    {
        this._workerTargetTreeElementMap.clear();
        this._mainFrameTreeElement = null;
        this._extensionScriptsFolderTreeElement = null;
        this._extraScriptsFolderTreeElement = null;
        this._anonymousScriptsFolderTreeElement = null;

        this._originTreeElementMap.clear();

        let resourceGroupingModeScopeBarItem = this._resourceGroupingModeScopeBarItems[WI.settings.resourceGroupingMode.value];
        console.assert(resourceGroupingModeScopeBarItem);
        if (resourceGroupingModeScopeBarItem)
            resourceGroupingModeScopeBarItem.selected = true;

        this._resourcesTreeOutline.removeChildren();

        let mainFrame = WI.networkManager.mainFrame;
        if (mainFrame) {
            this._updateMainFrameTreeElement(mainFrame);
            this._addResourcesRecursivelyForFrame(mainFrame);

            for (let frame of WI.networkManager.frames) {
                if (frame !== mainFrame)
                    this._addResourcesRecursivelyForFrame(frame);
            }
        }

        for (let script of WI.debuggerManager.knownNonResourceScripts) {
            this._addScript(script);

            if (script.sourceMaps.length && WI.SourcesNavigationSidebarPanel.shouldPlaceResourcesAtTopLevel())
                this._resourcesTreeOutline.disclosureButtons = true;
        }
    }

    _handleFrameMainResourceDidChange(event)
    {
        let frame = event.target;
        if (frame.isMainFrame()) {
            this._updateMainFrameTreeElement(frame);
            this._addResourcesRecursivelyForFrame(frame);

            for (let domBreakpoint of WI.domDebuggerManager.domBreakpoints)
                this._removeBreakpoint(domBreakpoint);
        }

        if (!event.data.oldMainResource) {
            let resource = event.target.mainResource;
            this._addBreakpointsForSourceCode(resource);
            this._addIssuesForSourceCode(resource);
        }
    }

    _handleResourceAdded(event)
    {
        this._addResource(event.data.resource);
    }

    _handleFrameWasAdded(event)
    {
        let {frame} = event.data;

        if (frame.isMainFrame())
            this._updateMainFrameTreeElement(frame);

        this._addResourcesRecursivelyForFrame(frame);
    }

    _handleBootstrapScriptCreated(event)
    {
        this._addLocalOverride(event.data.bootstrapScript);
    }

    _handleBootstrapScriptDestroyed(event)
    {
        this._removeResourceOverride(event.data.bootstrapScript);
    }

    _handleLocalResourceOverrideAdded(event)
    {
        this._addLocalOverride(event.data.localResourceOverride);
    }

    _handleLocalResourceOverrideRemoved(event)
    {
        this._removeResourceOverride(event.data.localResourceOverride);
    }

    _handleDebuggerBreakpointAdded(event)
    {
        this._addBreakpoint(event.data.breakpoint);
    }

    _handleDebuggerBreakpointRemoved(event)
    {
        this._removeBreakpoint(event.data.breakpoint);
    }

    _handleDebuggerBreakpointsEnabledDidChange(event)
    {
        this._debuggerBreakpointsButtonItem.activated = WI.debuggerManager.breakpointsEnabled;

        this._updateBreakpointsDisabledBanner();
    }

    _handleDebuggerScriptAdded(event)
    {
        this._addScript(event.data.script);
    }

    _handleDebuggerScriptRemoved(event)
    {
        let script = event.data.script;
        let scriptTreeElement = this._resourcesTreeOutline.findTreeElement(script);
        if (!scriptTreeElement)
            return;

        let parentTreeElement = scriptTreeElement.parent;
        parentTreeElement.removeChild(scriptTreeElement);

        if (parentTreeElement instanceof WI.FolderTreeElement || parentTreeElement instanceof WI.OriginTreeElement) {
            parentTreeElement.representedObject.remove(script);

            if (!parentTreeElement.children.length)
                parentTreeElement.parent.removeChild(parentTreeElement);
        }
    }

    _handleDebuggerScriptsCleared(event)
    {
        const suppressOnDeselect = true;
        const suppressSelectSibling = true;

        for (let i = this._breakpointsTreeOutline.children.length - 1; i >= 0; --i) {
            let treeElement = this._breakpointsTreeOutline.children[i];
            if (!(treeElement instanceof WI.ScriptTreeElement))
                continue;

            this._breakpointsTreeOutline.removeChild(treeElement, suppressOnDeselect, suppressSelectSibling);
        }

        if (this._extensionScriptsFolderTreeElement) {
            if (this._extensionScriptsFolderTreeElement.parent)
                this._extensionScriptsFolderTreeElement.parent.removeChild(this._extensionScriptsFolderTreeElement, suppressOnDeselect, suppressSelectSibling);

            this._extensionScriptsFolderTreeElement.representedObject.clear();
            this._extensionScriptsFolderTreeElement = null;
        }

        if (this._extraScriptsFolderTreeElement) {
            if (this._extraScriptsFolderTreeElement.parent)
                this._extraScriptsFolderTreeElement.parent.removeChild(this._extraScriptsFolderTreeElement, suppressOnDeselect, suppressSelectSibling);

            this._extraScriptsFolderTreeElement.representedObject.clear();
            this._extraScriptsFolderTreeElement = null;
        }

        if (this._anonymousScriptsFolderTreeElement) {
            if (this._anonymousScriptsFolderTreeElement.parent)
                this._anonymousScriptsFolderTreeElement.parent.removeChild(this._anonymousScriptsFolderTreeElement, suppressOnDeselect, suppressSelectSibling);

            this._anonymousScriptsFolderTreeElement.representedObject.clear();
            this._anonymousScriptsFolderTreeElement = null;
        }

        if (this._workerTargetTreeElementMap.size) {
            for (let treeElement of this._workerTargetTreeElementMap.values())
                treeElement.parent.removeChild(treeElement, suppressOnDeselect, suppressSelectSibling);
            this._workerTargetTreeElementMap.clear();
        }

        this._addResourcesRecursivelyForFrame(WI.networkManager.mainFrame);
    }

    _handleDebuggerPaused(event)
    {
        this._callStackContainer.hidden = false;

        if (this._updatePauseReason())
            this._pauseReasonContainer.hidden = false;

        this._debuggerPauseResumeButtonItem.enabled = true;
        this._debuggerPauseResumeButtonItem.toggled = true;
        this._debuggerStepOverButtonItem.enabled = true;
        this._debuggerStepIntoButtonItem.enabled = true;
        this._debuggerStepOutButtonItem.enabled = true;

        this.element.classList.add("paused");
    }

    _handleDebuggerResumed(event)
    {
        this._callStackContainer.hidden = true;

        this._pauseReasonContainer.hidden = true;

        this._debuggerPauseResumeButtonItem.enabled = true;
        this._debuggerPauseResumeButtonItem.toggled = false;
        this._debuggerStepOverButtonItem.enabled = false;
        this._debuggerStepIntoButtonItem.enabled = false;
        this._debuggerStepOutButtonItem.enabled = false;

        this.element.classList.remove("paused");
    }

    _handleDebuggerCallFramesDidChange(event)
    {
        let {target} = event.data;
        let treeElement = this._findCallStackTargetTreeElement(target);
        console.assert(treeElement);
        if (treeElement)
            treeElement.refresh();

        let activeCallFrameTreeElement = this._callStackTreeOutline.findTreeElement(WI.debuggerManager.activeCallFrame);
        if (activeCallFrameTreeElement)
            activeCallFrameTreeElement.reveal();
    }

    _handleDebuggerActiveCallFrameDidChange(event)
    {
        if (this._activeCallFrameTreeElement) {
            this._activeCallFrameTreeElement.isActiveCallFrame = false;
            this._activeCallFrameTreeElement = null;
        }

        if (!WI.debuggerManager.activeCallFrame)
            return;

        this._activeCallFrameTreeElement = this._callStackTreeOutline.findTreeElement(WI.debuggerManager.activeCallFrame);
        if (this._activeCallFrameTreeElement)
            this._activeCallFrameTreeElement.isActiveCallFrame = true;
    }

    _handleDebuggerWaitingToPause(event)
    {
        this._debuggerPauseResumeButtonItem.enabled = false;
    }

    _handleDebuggerObjectDisplayLocationDidChange(event)
    {
        let debuggerObject = event.target;

        if (event.data.oldDisplaySourceCode === debuggerObject.sourceCodeLocation.displaySourceCode)
            return;

        // A known debugger object (breakpoint, issueMessage, etc.) moved between resources. Remove
        // the old tree element and create a new tree element with the updated file.

        let wasSelected = false;
        let oldDebuggerTreeElement = null;
        let newDebuggerTreeElement = null;
        if (debuggerObject instanceof WI.Breakpoint) {
            oldDebuggerTreeElement = this._breakpointsTreeOutline.findTreeElement(debuggerObject);
            if (oldDebuggerTreeElement)
                wasSelected = oldDebuggerTreeElement.selected;

            newDebuggerTreeElement = this._addBreakpoint(debuggerObject);
        } else if (debuggerObject instanceof WI.IssueMessage) {
            oldDebuggerTreeElement = this._resourcesTreeOutline.findTreeElement(debuggerObject);
            if (oldDebuggerTreeElement)
                wasSelected = oldDebuggerTreeElement.selected;

            newDebuggerTreeElement = this._addIssue(debuggerObject);
        }

        if (!newDebuggerTreeElement)
            return;

        if (oldDebuggerTreeElement)
            this._removeDebuggerTreeElement(oldDebuggerTreeElement);

        if (wasSelected)
            newDebuggerTreeElement.revealAndSelect(true, false, true);
    }

    _handleDOMBreakpointDOMNodeChanged(event)
    {
        let breakpoint = event.target;
        if (breakpoint.domNodeIdentifier)
            this._addBreakpoint(breakpoint);
        else
            this._removeBreakpoint(breakpoint);
    }

    _handleConsoleIssueAdded(event)
    {
        let {issue} = event.data;

        // We only want to show issues originating from JavaScript source code.
        if (!issue.sourceCodeLocation || !issue.sourceCodeLocation.sourceCode || (issue.source !== "javascript" && issue.source !== "console-api"))
            return;

        this._addIssue(issue);
    }

    _handleConsoleCleared(event)
    {
        let issueTreeElements = [];
        let currentTreeElement = this._resourcesTreeOutline.children[0];
        while (currentTreeElement && !currentTreeElement.root) {
            if (currentTreeElement instanceof WI.IssueTreeElement)
                issueTreeElements.push(currentTreeElement);

            const skipUnrevealed = false;
            const stayWithin = null;
            const dontPopulate = true;
            currentTreeElement = currentTreeElement.traverseNextTreeElement(skipUnrevealed, stayWithin, dontPopulate);
        }

        issueTreeElements.forEach((treeElement) => treeElement.parent.removeChild(treeElement));
    }

    _handleTimelineCapturingStateChanged(event)
    {
        this._updateTemporarilyDisabledBreakpointsButtons();

        switch (WI.timelineManager.capturingState) {
        case WI.TimelineManager.CapturingState.Starting:
            if (!this._timelineRecordingWarningElement) {
                let stopRecordingButton = document.createElement("button");
                stopRecordingButton.textContent = WI.UIString("Stop recording");
                stopRecordingButton.addEventListener("click", () => {
                    WI.timelineManager.stopCapturing();
                });

                this._timelineRecordingWarningElement = document.createElement("div");
                this._timelineRecordingWarningElement.classList.add("warning-banner");
                this._timelineRecordingWarningElement.append(WI.UIString("Debugger disabled during Timeline recording"), document.createElement("br"), stopRecordingButton);
            }

            this.contentView.element.insertBefore(this._timelineRecordingWarningElement, this.contentView.element.firstChild);
            break;

        case WI.TimelineManager.CapturingState.Inactive:
            if (this._timelineRecordingWarningElement) {
                this._timelineRecordingWarningElement.remove();
                this._timelineRecordingWarningElement = null;
            }
            break;
        }

        this._updateBreakpointsDisabledBanner();
    }

    _handleAuditManagerTestScheduled(event)
    {
        this._updateTemporarilyDisabledBreakpointsButtons();

        if (!this._auditTestWarningElement) {
            let stopAuditButton = document.createElement("button");
            stopAuditButton.textContent = WI.UIString("Stop Audit");
            stopAuditButton.addEventListener("click", (event) => {
                WI.auditManager.stop();
            });

            this._auditTestWarningElement = document.createElement("div");
            this._auditTestWarningElement.classList.add("warning-banner");
            this._auditTestWarningElement.append(WI.UIString("Debugger disabled during Audit"), document.createElement("br"), stopAuditButton);
        }

        this.contentView.element.insertBefore(this._auditTestWarningElement, this.contentView.element.firstChild);

        this._updateBreakpointsDisabledBanner();
    }

    _handleAuditManagerTestCompleted(event)
    {
        this._updateTemporarilyDisabledBreakpointsButtons();

        if (this._auditTestWarningElement) {
            this._auditTestWarningElement.remove();
            this._auditTestWarningElement = null;
        }

        this._updateBreakpointsDisabledBanner();
    }

    _handleCSSStyleSheetAdded(event)
    {
        let styleSheet = event.data.styleSheet;
        if (!styleSheet.isInspectorStyleSheet())
            return;

        if (WI.settings.resourceGroupingMode.value === WI.Resource.GroupingMode.Type) {
            let frameTreeElement = this.treeElementForRepresentedObject(styleSheet.parentFrame);
            if (frameTreeElement) {
                frameTreeElement.addRepresentedObjectToNewChildQueue(styleSheet);
                return;
            }
        }

        this._addResource(styleSheet);
    }

    _handleTargetAdded(event)
    {
        this._addTarget(event.data.target);
    }

    _handleTargetRemoved(event)
    {
        let {target} = event.data;

        let workerTreeElement = this._workerTargetTreeElementMap.take(target);
        if (workerTreeElement)
            workerTreeElement.parent.removeChild(workerTreeElement);

        let callStackTreeElement = this._findCallStackTargetTreeElement(target);
        console.assert(callStackTreeElement);
        if (callStackTreeElement)
            this._callStackTreeOutline.removeChild(callStackTreeElement);

        this._updateCallStackTreeOutline();
    }

    _handleExtraDomainsActivated()
    {
        if (WI.SourcesNavigationSidebarPanel.shouldPlaceResourcesAtTopLevel())
            this._resourcesTreeOutline.disclosureButtons = true;
    }
};

WI.SourcesNavigationSidebarPanel.ResourceTypeSymbol = Symbol("resource-type");
WI.SourcesNavigationSidebarPanel.ResourceGroupingModeSymbol = Symbol("resource-grouping-mode");
