import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild
} from "@angular/core";
import { NgbTooltipConfig } from "@ng-bootstrap/ng-bootstrap";
import "brace";
import "brace/ext/searchbox";
import "brace/index";
import "brace/mode/css";
import "brace/mode/html.js";
import "brace/mode/json.js";
import "brace/mode/text.js";
import "brace/mode/xml.js";
import { ipcRenderer, remote, shell } from "electron";
import * as mimeTypes from "mime-types";
import { DragulaService } from "ng2-dragula";
import * as path from "path";
import { ContextMenuItemPayload } from "src/app/components/context-menu.component";
import { Config } from "src/app/config";
import { AnalyticsEvents } from "src/app/enums/analytics-events.enum";
import { Alert, AlertService } from "src/app/services/alert.service";
import { AnalyticsService } from "src/app/services/analytics.service";
import { AuthService } from "src/app/services/auth.service";
import { EnvironmentsService } from "src/app/services/environments.service";
import {
  ContextMenuEventType,
  EventsService
} from "src/app/services/events.service";
import { ServerService } from "src/app/services/server.service";
import { UpdateService } from "src/app/services/update.service";
import { DataSubjectType } from "src/app/types/data.type";
import {
  CurrentEnvironmentType,
  EnvironmentsType,
  EnvironmentType
} from "src/app/types/environment.type";
import {
  headerNames,
  headerValues,
  methods,
  mimeTypesWithTemplating,
  RouteType,
  statusCodes,
  statusCodesExplanation,
  MyFilterPipe
} from "src/app/types/route.type";
import "../assets/custom_theme.js";
import { filter } from "rxjs/operators";
const platform = require("os").platform();
const appVersion = require("../../package.json").version;
const arrayMove = require("array-move");

type TabsNameType = "RESPONSE" | "HEADERS" | "ENV_SETTINGS" | "ENV_LOGS";

@Component({
  selector: "app-root",
  templateUrl: "./app.component.html"
})
export class AppComponent implements OnInit {
  @ViewChild("routesMenu") private routesMenu: ElementRef;
  @ViewChild("environmentsMenu") private environmentsMenu: ElementRef;
  public environments: EnvironmentsType;
  public currentEnvironment: CurrentEnvironmentType = null;
  public currentRoute: { route: RouteType; index: number } = null;
  public methods = methods;
  public statusCodes = statusCodes;
  public statusCodesExplanation = statusCodesExplanation;
  public saving = false;
  public editorConfig: any = {
    options: {
      fontSize: "1rem",
      wrap: "free",
      showPrintMargin: false,
      tooltipFollowsMouse: false,
      useWorker: false
    },
    mode: "json",
    theme: "custom_theme"
  };
  public currentTab: TabsNameType = "RESPONSE";
  public alerts: Alert[];
  public updateAvailable = false;
  public platform = platform;
  public headerNamesList = headerNames;
  public headerValuesList = headerValues;
  public getRouteContentType = this.environmentsService.getRouteContentType;
  public hasEnvironmentHeaders = this.environmentsService.hasEnvironmentHeaders;
  public clearEnvironmentLogsTimeout: NodeJS.Timer;
  public environmentLogs = this.serverService.environmentsLogs;
  public appVersion = appVersion;
  private settingsModalOpened = false;
  private dialog = remote.dialog;
  private BrowserWindow = remote.BrowserWindow;
  private dragDeadzone = 10;
  private lastMouseDownPosition: { x: number; y: number };

  constructor(
    public environmentsService: EnvironmentsService,
    private serverService: ServerService,
    private alertService: AlertService,
    private updateService: UpdateService,
    private authService: AuthService,
    private eventsService: EventsService,
    private config: NgbTooltipConfig,
    private dragulaService: DragulaService,
    private analyticsService: AnalyticsService
  ) {
    // tooltip config
    this.config.container = "body";
    this.config.placement = "bottom";

    // set listeners on main process messages
    ipcRenderer.on("keydown", (event, data) => {
      switch (data.action) {
        case "NEW_ENVIRONMENT":
          this.addEnvironment();
          break;
        case "NEW_ROUTE":
          this.addRoute();
          break;
        case "START_ENVIRONMENT":
          if (this.currentEnvironment) {
            this.toggleEnvironment(this.currentEnvironment.environment);
          }
          break;
        case "DUPLICATE_ENVIRONMENT":
          if (this.currentEnvironment) {
            this.duplicateEnvironment(this.currentEnvironment.index);
          }
          break;
        case "DUPLICATE_ROUTE":
          if (this.currentRoute) {
            this.duplicateRoute(this.currentRoute.index);
          }
          break;
        case "DELETE_ENVIRONMENT":
          if (this.currentEnvironment) {
            this.removeEnvironment(this.currentEnvironment.index);
          }
          break;
        case "DELETE_ROUTE":
          if (this.currentRoute) {
            this.removeRoute(this.currentRoute.index);
            // this.myremoveRoute(this.currentRoute.route);
          }
          break;
        case "PREVIOUS_ENVIRONMENT":
          if (this.currentEnvironment) {
            this.selectEnvironment(this.currentEnvironment.index - 1);
          }
          break;
        case "NEXT_ENVIRONMENT":
          if (this.currentEnvironment) {
            this.selectEnvironment(this.currentEnvironment.index + 1);
          }
          break;
        case "PREVIOUS_ROUTE":
          if (this.currentRoute) {
            this.selectRoute(this.currentRoute.index - 1);
          }
          break;
        case "NEXT_ROUTE":
          if (this.currentRoute) {
            this.selectRoute(this.currentRoute.index + 1);
          }
          break;
        case "OPEN_SETTINGS":
          if (!this.settingsModalOpened) {
            this.settingsModalOpened = true;
            this.eventsService.settingsModalEvents.emit(true);
          }
          break;
        case "IMPORT_FILE":
          this.environmentsService.importEnvironmentsFile(() => {
            if (!this.currentEnvironment) {
              this.selectEnvironment(0);
            }
          });
          break;
        case "IMPORT_CHARLES":
          this.environmentsService.importCharlesFile((this.currentEnvironment));
          break;
        case "IMPORT_CLIPBOARD":
          this.environmentsService.importFromClipboard(this.currentEnvironment);
          break;
        case "EXPORT_FILE":
          this.environmentsService.exportAllEnvironments();
          break;
      }
    });
  }

  ngOnInit() {
    this.analyticsService.init();

    // auth anonymously through firebase
    this.authService.auth();

    this.environmentsService.environmentsReady.subscribe((ready: true) => {
      this.environments = this.environmentsService.environments;

      // send first GA requests when env are ready
      this.eventsService.analyticsEvents.next(AnalyticsEvents.PAGEVIEW);
      this.eventsService.analyticsEvents.next(
        AnalyticsEvents.APPLICATION_START
      );

      this.selectEnvironment(0);
      // if(this.currentEnvironment) {
      //   this.toggleEnvironment(this.currentEnvironment.environment);
      // }
      if(this.environments) {
        for (var it = 0 ; it < this.environments.length ; it++) {
          this.startEnvironment(this.environments[it]);
        }
      }
    });

    this.environmentsService.selectEnvironment.subscribe(
      (environmentIndex: number) => {
        this.selectEnvironment(environmentIndex);
      }
    );

    this.alerts = this.alertService.alerts;

    // subscribe to update events
    this.updateService.updateAvailable.subscribe(() => {
      this.updateAvailable = true;
    });

    this.initDragMonitoring();
  }

  /**
   * Prevent dragging of envs/routes for small moves
   *
   * @param event
   */
  @HostListener("mousedown", ["$event"]) onMouseDown(event: MouseEvent) {
    this.lastMouseDownPosition = { x: event.clientX, y: event.clientY };
  }
  @HostListener("mousemove", ["$event"]) onMouseMove(event: MouseEvent) {
    // if left mouse button pressed
    if (this.lastMouseDownPosition && event.buttons === 1) {
      const delta = Math.sqrt(
        Math.pow(event.clientX - this.lastMouseDownPosition.x, 2) +
          Math.pow(event.clientY - this.lastMouseDownPosition.y, 2)
      );

      if (delta < this.dragDeadzone) {
        event.stopPropagation();
      }
    }
  }

  /**
   * Handle mouse wheel events on numbers fields
   */
  @HostListener("mousewheel", ["$event"]) onMouseWheel(event: any) {
    // Mouse wheel on environment port
    if (event.target.name === "environment.port") {
      event.preventDefault();

      const modifier = 1 * Math.sign(event.wheelDeltaY);
      if (
        modifier > 0 ||
        (modifier < 0 && this.currentEnvironment.environment.port !== 0)
      ) {
        this.currentEnvironment.environment.port += modifier;
        this.environmentUpdated("port");
      }
    }

    // Mouse wheel on environment latency
    if (event.target.name === "environment.latency") {
      event.preventDefault();

      const modifier = 1 * Math.sign(event.wheelDeltaY);
      if (
        modifier > 0 ||
        (modifier < 0 && this.currentEnvironment.environment.latency !== 0)
      ) {
        this.currentEnvironment.environment.latency += modifier;
        this.environmentUpdated("envLatency");
      }
    }

    // Mouse wheel on route latency
    if (event.target.name === "route.latency") {
      event.preventDefault();

      const modifier = 1 * Math.sign(event.wheelDeltaY);
      if (
        modifier > 0 ||
        (modifier < 0 && this.currentRoute.route.latency !== 0)
      ) {
        this.currentRoute.route.latency += modifier;
        this.environmentUpdated("routeLatency");
      }
    }
  }

  /**
   * Trigger env/route saving and re-selection when draging active route/env
   */
  public initDragMonitoring() {
    // on drop reselect if we moved a selected env/route
    this.dragulaService.dropModel().subscribe(movedItem => {
      if (movedItem.name === "environmentsContainer") {
        arrayMove.mut(
          this.environments,
          movedItem.sourceIndex,
          movedItem.targetIndex
        );

        const selectedEnvironmentIndex = this.environmentsService.findEnvironmentIndex(
          this.currentEnvironment.environment.uuid
        );
        this.selectEnvironment(selectedEnvironmentIndex);

        this.environmentUpdated("envReorder", true);
      } else if (movedItem.name === "routesContainer") {
        arrayMove.mut(
          this.filteredRoutes(this.currentEnvironment.environment.routes),
          movedItem.sourceIndex,
          movedItem.targetIndex
        );

        const selectedRouteIndex = this.environmentsService.findRouteIndex(
          this.currentEnvironment.environment,
          this.currentRoute.route.uuid
        );
        this.selectRoute(selectedRouteIndex);

        this.environmentUpdated("routeReorder", true);
      }
    });
  }
  /**
   * Toggle environment running state (start/stop)
   *
   * @param environment - environment
   */
  public toggleEnvironment(environment: EnvironmentType) {
    if (environment) {
      if (environment.running) {
        this.serverService.stop(environment);

        this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_STOP);

        if (environment.needRestart) {
          this.serverService.start(environment);
          this.eventsService.analyticsEvents.next(
            AnalyticsEvents.SERVER_RESTART
          );
        }

        // if stopping or restarting, restart is not needed
        environment.needRestart = false;
      } else {
        this.serverService.start(environment);
        this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_START);
      }
    }
  }

  public startEnvironment(environment: EnvironmentType) {
    if (environment) {
      if (environment.running) {
        return;
      } else {
        this.serverService.start(environment);
        this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_START);
      }
    }
  }

  public selectEnvironment(environmentIndex: number) {
    // check if selection exists
    if (
      environmentIndex >= 0 &&
      environmentIndex <= this.environments.length - 1
    ) {
      this.currentEnvironment = {
        environment: this.environments[environmentIndex],
        index: environmentIndex
      };

      // select first route
      this.selectRoute(0);

      // auto scroll routes to top when navigating environments
      if (this.routesMenu) {
        this.routesMenu.nativeElement.scrollTop = 0;
      }

      this.eventsService.analyticsEvents.next(
        AnalyticsEvents.NAVIGATE_ENVIRONMENT
      );
    }
  }

  public setCurrentTab(tabName: TabsNameType) {
    this.currentTab = tabName;
  }

  public clearEnvironmentLogs(currentEnvironment: CurrentEnvironmentType) {
    if (this.clearEnvironmentLogsTimeout) {
      this.serverService.clearEnvironmentLogs(
        currentEnvironment.environment.uuid
      );
      clearTimeout(this.clearEnvironmentLogsTimeout);
      this.clearEnvironmentLogsTimeout = undefined;
    } else {
      this.clearEnvironmentLogsTimeout = setTimeout(() => {
        this.clearEnvironmentLogsTimeout = undefined;
      }, 4000);
    }
  }

  public filteredRoutes(routes: RouteType[]) {
    // console.log("filter function all routes\n", routes);
    const searchText = document.getElementById("mySearchText");
    var searchString = "";
    if(searchText != undefined && searchText.getAttribute("ng-reflect-model") != null) {
      searchString = searchText.getAttribute("ng-reflect-model");
      if (searchString.length < 2) {
        return routes
      }
      // console.log("SEARCH DATA", searchString);
      const allRoutes = this.currentEnvironment.environment.routes;
      const filteredRoutes = allRoutes.filter(element => {
      return element.endpoint.includes(searchString);
      });
      // console.log("routes", filteredRoutes[0]);
      return filteredRoutes;
    }
    return routes;
  }

  public selectRoute(routeIndex: number) {
    // check if selection exists
    // console.log("SELECT ROUTE ", routeIndex);
    const myRoutes = this.filteredRoutes(this.currentEnvironment.environment.routes);
    // console.log("ALL ROUTES\n", myRoutes);
    if (
      myRoutes.length > 0 &&
      routeIndex >= 0 &&
      routeIndex <= myRoutes.length - 1
    ) {
      // go on first tab when switching route
      this.currentTab = "RESPONSE";

      this.currentRoute = {
        route: myRoutes[routeIndex],
        index: routeIndex
      };

      this.changeEditorSettings();

      this.eventsService.analyticsEvents.next(AnalyticsEvents.NAVIGATE_ROUTE);
    } else {
      this.currentTab = "ENV_SETTINGS";
      this.currentRoute = null;
    }
    // }
  }
  public addEnvironment() {
    const index = this.environmentsService.addEnvironment();

    this.selectEnvironment(index);

    this.scrollToBottom(this.environmentsMenu.nativeElement);

    this.startEnvironment(this.environments[index]);
  }

  public addRoute() {
    if (this.currentEnvironment) {
      this.environmentUpdated("addRoute", false);

      const index = this.environmentsService.addRoute(
        this.currentEnvironment.environment
      );

      this.selectRoute(index);

      this.scrollToBottom(this.routesMenu.nativeElement);
    }
  }

  // public randomRoutesUpdated(body: string = '', index: number) {
  //   this.currentRoute.route.randomBodies[index] = body
  // }

  /**
   * Function getting called each time a field is updated
   *
   * @param fieldUpdated - name of the update field
   * @param propagate - should propagate event to env service
   */
  public environmentUpdated(fieldUpdated: string = "", propagate = true) {
    const restartNotNeeded = [
      "name",
      "envLatency",
      "routeLatency",
      "statusCode",
      "file",
      "routeHeaders",
      "environmentHeaders",
      "body",
      "envReorder",
      "fileSendAsBody",
      "documentation"
    ];
    this.currentEnvironment.environment.modifiedAt = new Date();

    // restart is not needed for some fields
    if (!restartNotNeeded.includes(fieldUpdated)) {
      if (this.currentEnvironment.environment.running) {
        this.currentEnvironment.environment.needRestart =
          this.currentEnvironment.environment.modifiedAt >
          this.currentEnvironment.environment.startedAt;
      }
    }

    if (
      fieldUpdated === "routeHeaders" ||
      fieldUpdated === "environmentHeaders"
    ) {
      this.changeEditorSettings();
    }

    if (propagate) {
      this.environmentsService.environmentUpdateEvents.next({
        environment: this.currentEnvironment.environment
      });
    }
    // console.log("environment " + JSON.stringify(this.currentEnvironment.environment));
  }

  /**
   * Remove route and navigate depending on remaining routes
   *
   * @param routeIndex
   */
  private removeRoute(routeIndex: number) {
    this.environmentUpdated("removeRoute", false);


    const delRoute = this.filteredRoutes(this.currentEnvironment.environment.routes)[routeIndex];

    this.currentEnvironment.environment.routes = this.currentEnvironment.environment.routes.filter(function(val, i, arr) {
      return val != delRoute;
    });

    // this.environmentsService.removeRoute(
    //   this.currentEnvironment.environment,
    //   routeIndex
    // );

    // if same route than deleted one
    if (routeIndex === this.currentRoute.index) {
      // if there is still something to navigate to, navigate
      if (this.filteredRoutes(this.currentEnvironment.environment.routes).length > 0) {
        // select previous route or index 0 if currently on 0
        this.selectRoute(routeIndex === 0 ? 0 : routeIndex - 1);
      } else {
        this.currentTab = "ENV_SETTINGS";
        this.currentRoute = null;
      }
    } else if (routeIndex < this.currentRoute.index) {
      // if an above route, select minus 1
      this.selectRoute(this.currentRoute.index - 1);
    }
  }

  /**
   * Remove environment and navigate depending on remaining environments
   *
   * @param environmentIndex
   */
  private removeEnvironment(environmentIndex: number) {
    this.environmentsService.removeEnvironment(environmentIndex);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.DELETE_ENVIRONMENT);

    // if same environment than deleted one
    if (environmentIndex === this.currentEnvironment.index) {
      // if there is still something to navigate to, navigate
      if (this.environments.length > 0) {
        // select previous environment or index 0 if currently on 0
        this.selectEnvironment(
          environmentIndex === 0 ? 0 : environmentIndex - 1
        );
      } else {
        // navigate to nothing
        this.currentEnvironment = null;
        this.currentRoute = null;
      }
    } else if (environmentIndex < this.currentEnvironment.index) {
      // if an above environment, select minus 1
      this.selectEnvironment(this.currentEnvironment.index - 1);
    }
  }

  /**
   * Open GET routes in the browser
   */
  public openRouteInBrowser() {
    if (this.currentEnvironment.environment.running) {
      let routeUrl =
        (this.currentEnvironment.environment.https ? "https://" : "http://") +
        "localhost:" +
        this.currentEnvironment.environment.port +
        "/";

      if (this.currentEnvironment.environment.endpointPrefix) {
        routeUrl += this.currentEnvironment.environment.endpointPrefix + "/";
      }

      routeUrl += this.currentRoute.route.endpoint;

      shell.openExternal(routeUrl);

      this.eventsService.analyticsEvents.next(
        AnalyticsEvents.LINK_ROUTE_IN_BROWSER
      );
    }
  }

  public browseFiles() {
    this.dialog.showOpenDialog(
      this.BrowserWindow.getFocusedWindow(),
      {},
      file => {
        if (file && file[0]) {
          this.updateRouteFile(file[0]);
        }
      }
    );
  }

  /**
   * Monitor file path input changes
   *
   * @param filePath
   */
  public onFileInputChange(filePath: string) {
    if (!filePath) {
      this.deleteFile();

      return;
    }
    this.updateRouteFile(filePath);
  }

  /**
   * Update the route file object from a path
   *
   * @param filePath
   */
  private updateRouteFile(filePath: string) {
    this.currentRoute.route.file = {
      ...this.currentRoute.route.file,
      path: filePath,
      filename: path.basename(filePath),
      mimeType: mimeTypes.lookup(filePath)
    };

    this.environmentUpdated("file");
  }

  public deleteFile() {
    this.currentRoute.route.file = null;
    this.environmentUpdated("file");
  }

  /**
   * Pass remove event to alert service
   *
   * @param alertId
   */
  public removeAlert(alertId: string) {
    this.alertService.removeAlert(alertId);
  }

  public isValidURL(URL: string) {
    return this.serverService.isValidURL(URL);
  }

  public openFeedbackLink() {
    shell.openExternal(Config.feedbackLink);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_FEEDBACK);
  }

  public openChangelogModal() {
    this.eventsService.changelogModalEvents.next(true);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_RELEASE);
  }

  public openWikiLink(linkName: string) {
    shell.openExternal(Config.wikiLinks[linkName]);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_WIKI);
  }

  public addAlternateRouteBody() {
    if (!this.currentRoute.route.alternateRoutes) {
      this.currentRoute.route.alternateRoutes = [];
    }
    this.currentRoute.route.alternateRoutes.push(
      `{ "index": ${this.currentRoute.route.alternateRoutes.length} }`
    );
  }

  public removeAlternateRouteBody(index) {
    if (index < 0) {
      return;
    }
    if (window.confirm(`Are you sure you want to delete ${index}`)) {
      if(index == 0) {
        if(this.currentRoute.route.alternateRoutes.length > 1) {
          this.currentRoute.route.selectedAlternateRoute = index + 1;
        } else {
          this.currentRoute.route.selectedAlternateRoute = -1;
        }
      } else {
        this.currentRoute.route.selectedAlternateRoute = index - 1;
      }
      this.currentRoute.route.alternateRoutes = this.currentRoute.route.alternateRoutes.filter(
        function(_, i, arr) {
          return i != index;
        }
      );
    }
  }

  public applyUpdate() {
    this.updateService.applyUpdate();

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_APPLY_UPDATE);
  }

  /**
   * Set editor mode depending on content type
   */
  private changeEditorSettings() {
    const contentType = this.environmentsService.getRouteContentType(
      this.currentEnvironment.environment,
      this.currentRoute.route
    );

    if (contentType === "application/json") {
      this.editorConfig.mode = "json";
    } else if (
      contentType === "text/html" ||
      contentType === "application/xhtml+xml"
    ) {
      this.editorConfig.mode = "html";
    } else if (contentType === "application/xml") {
      this.editorConfig.mode = "xml";
    } else if (contentType === "text/css") {
      this.editorConfig.mode = "css";
    } else {
      this.editorConfig.mode = "text";
    }
  }

  /**
   * Show and position the context menu
   *
   * @param event - click event
   */
  public navigationContextMenu(
    subject: DataSubjectType,
    subjectId: number,
    event: any
  ) {
    // if right click display context menu
    if (event && event.which === 3) {
      const menu: ContextMenuEventType = {
        event: event,
        items: [
          {
            payload: {
              subject,
              action: "duplicate",
              subjectId
            },
            label: "Duplicate " + subject,
            icon: "content_copy"
          },
          {
            payload: {
              subject,
              action: "export",
              subjectId
            },
            label: "Copy to clipboard (JSON)",
            icon: "assignment"
          },
          {
            payload: {
              subject,
              action: "delete",
              subjectId
            },
            label: "Delete " + subject,
            icon: "delete",
            confirm: {
              icon: "error",
              label: "Confirm deletion"
            },
            confirmColor: "text-danger"
          }
        ]
      };

      if (subject === "environment") {
        menu.items.unshift(
          {
            payload: {
              subject,
              action: "env_logs",
              subjectId
            },
            label: "Environment logs",
            icon: "history"
          },
          {
            payload: {
              subject,
              action: "env_settings",
              subjectId
            },
            label: "Environment settings",
            icon: "settings",
            separator: true
          }
        );
      }
      this.eventsService.contextMenuEvents.emit(menu);
    }
  }

  /**
   * Handle navigation context menu item click
   *
   * @param payload
   */
  public navigationContextMenuItemClicked(payload: ContextMenuItemPayload) {
    switch (payload.action) {
      case "env_logs":
        if (payload.subjectId !== this.currentEnvironment.index) {
          this.selectEnvironment(payload.subjectId);
        }
        this.setCurrentTab("ENV_LOGS");
        break;
      case "env_settings":
        if (payload.subjectId !== this.currentEnvironment.index) {
          this.selectEnvironment(payload.subjectId);
        }
        this.setCurrentTab("ENV_SETTINGS");
        break;
      case "duplicate":
        if (payload.subject === "route") {
          this.duplicateRoute(payload.subjectId);
        } else if (payload.subject === "environment") {
          this.duplicateEnvironment(payload.subjectId);
        }
        break;
      case "export":
        this.exportToClipboard(payload.subject, payload.subjectId);
        break;
      case "delete":
        if (payload.subject === "route") {
          console.log(payload);
          this.removeRoute(payload.subjectId);
        } else if (payload.subject === "environment") {
          this.removeEnvironment(payload.subjectId);
        }
        break;
    }
  }

  /**
   * Duplicate an environment
   */
  public duplicateEnvironment(environmentIndex: number) {
    const index = this.environmentsService.duplicateEnvironment(
      environmentIndex
    );
    this.selectEnvironment(index);

    // auto scroll environments to bottom when adding
    this.environmentsMenu.nativeElement.scrollTop = this.environmentsMenu.nativeElement.scrollHeight;
  }

  /**
   * Duplicate a route
   */
  public duplicateRoute(routeIndex: number) {
    const index = this.environmentsService.duplicateRoute(
      this.currentEnvironment.environment,
      routeIndex
    );
    this.selectRoute(index);

    // auto scroll routes to bottom when adding
    this.routesMenu.nativeElement.scrollTop = this.routesMenu.nativeElement.scrollHeight;
  }

  public handleSettingsModalClosed() {
    this.settingsModalOpened = false;
  }

  /**
   * Export an environment to the clipboard
   *
   * @param subject
   * @param subjectIndex
   */
  public exportToClipboard(subject: DataSubjectType, subjectIndex: number) {
    if (subject === "environment") {
      this.environmentsService.exportEnvironmentToClipboard(subjectIndex);
    } else if (subject === "route") {
      this.environmentsService.exportRouteToClipboard(
        this.currentEnvironment.index,
        subjectIndex
      );
    }
  }

  /**
   * Check if selected file's mime type supports templating
   */
  public fileSupportsTemplating(): boolean {
    return (
      mimeTypesWithTemplating.indexOf(this.currentRoute.route.file.mimeType) >
      -1
    );
  }

  /**
   * Scroll to bottom of an element
   *
   * @param element
   */
  public scrollToBottom(element: Element) {
    setTimeout(() => {
      element.scrollTop = element.scrollHeight;
    });
  }

  public addCORSHeadersToEnvironment() {
    this.environmentsService.setEnvironmentCORSHeaders(
      this.currentEnvironment.environment
    );
  }

  public formatBody() {
    if (! this.currentRoute.route.body) {
      return;
    }
    const contentType = this.getRouteContentType(this.currentEnvironment.environment, this.currentRoute.route);
    if (contentType === 'application/json') {
      try {
        this.currentRoute.route.body = JSON.stringify(JSON.parse(this.currentRoute.route.body), undefined, 2);
      } catch (e) {
        // ignore any errors with parsing / stringifying the JSON
      }
    }
  }
}