(() => {
  const $ = (selector) => document.querySelector(selector);
  const STORE_KEY = "online-map-saved-places-v3";
  const DEFAULT_VIEW = {
    bearing: 0,
    lat: 16.0,
    layer: "streets",
    lng: 106.0,
    zoom: 6,
  };
  const DEFAULT_ROUTE = {
    active: false,
    destination: "",
    destinationLabel: "",
    destinationLat: null,
    destinationLng: null,
    origin: "",
    originLabel: "",
    originLat: null,
    originLng: null,
    travelMode: "driving",
  };
  const TRAVEL_PROFILES = {
    bicycling: [
      { base: "https://router.project-osrm.org", profile: "bike" },
      { base: "https://routing.openstreetmap.de/routed-bike", profile: "driving" },
    ],
    driving: [
      { base: "https://router.project-osrm.org", profile: "driving" },
      { base: "https://routing.openstreetmap.de/routed-car", profile: "driving" },
    ],
    walking: [
      { base: "https://router.project-osrm.org", profile: "foot" },
      { base: "https://routing.openstreetmap.de/routed-foot", profile: "driving" },
    ],
  };
  const VIETNAM_BOUNDS = [
    [8.179, 102.144],
    [23.393, 109.469],
  ];
  const ROUTE_STYLE = {
    color: "#0f766e",
    lineCap: "round",
    lineJoin: "round",
    opacity: 0.95,
    weight: 6,
  };
  const ROUTE_TRAVELED_STYLE = {
    color: "#94a3b8",
    lineCap: "round",
    lineJoin: "round",
    opacity: 0.82,
    weight: 6,
  };
  const ROUTE_ARROW_SIZE = 20;
  const NAVIGATION_ARROW_SIZE = 34;
  const REROUTE_COOLDOWN_MS = 8000;
  const ARRIVAL_RADIUS_METERS = 28;
  const DEFAULT_STATUS_MESSAGE = "Sẵn sàng";

  const els = {
    clearMarkersButton: $("#clearMarkersButton"),
    clearRouteButton: $("#clearRouteButton"),
    clearSavedButton: $("#clearSavedButton"),
    coordinateReadout: $("#coordinateReadout"),
    destinationInput: $("#destinationInput"),
    followUserButton: $("#followUserButton"),
    fullscreenButton: $("#fullscreenButton"),
    layerButtons: Array.from(document.querySelectorAll("[data-layer]")),
    locateButton: $("#locateButton"),
    map: $("#map"),
    mapArea: $(".map-area"),
    openDirectionsLink: $("#openDirectionsLink"),
    originInput: $("#originInput"),
    previewRouteButton: $("#previewRouteButton"),
    resultList: $("#resultList"),
    savedList: $("#savedList"),
    searchForm: $("#searchForm"),
    searchInput: $("#searchInput"),
    searchStatus: $("#searchStatus"),
    shareButton: $("#shareButton"),
    swapRouteButton: $("#swapRouteButton"),
    travelModeButtons: Array.from(document.querySelectorAll("[data-travel-mode]")),
    useMyLocationButton: $("#useMyLocationButton"),
    useViewedPlaceButton: $("#useViewedPlaceButton"),
    zoomVietnamButton: $("#zoomVietnamButton"),
  };

  const savedPlaces = loadSavedPlaces();
  let currentView = readSharedView() || { ...DEFAULT_VIEW };
  let routeState = readSharedRoute() || { ...DEFAULT_ROUTE };
  let activeLayer = currentView.layer;
  let searchController = null;
  let routeController = null;
  let searchMarker = null;
  let locationMarker = null;
  let navigationHeading = 0;
  let navigationLastLatLng = null;
  let navigationMarker = null;
  let navigationWatchId = null;
  let rerouteInFlight = false;
  let rerouteCooldownUntil = 0;
  let routeLatLngs = [];
  let routeLine = null;
  let routeTraveledLine = null;
  let statusTimer = null;
  let routeToastTimer = null;
  let followUserMode = false;
  let suppressFollowInteractionUntil = 0;

  const map = createMap();
  const tempMarkerLayer = L.layerGroup().addTo(map);
  const savedMarkerLayer = L.layerGroup().addTo(map);
  const navigationLayer = L.layerGroup().addTo(map);
  const routeMarkerLayer = L.layerGroup().addTo(map);
  const routeGeometryLayer = L.featureGroup().addTo(map);

  createIcons();
  bindEvents();
  syncRouteInputs();
  updateLayerButtons();
  updateTravelModeButtons();
  syncFollowUserButton();
  syncFullscreenButton();
  renderSavedPlaces();
  applyView(currentView, { animate: false });
  updateRouteLink();
  if (routeState.active && hasResolvedCoordinates(routeState)) {
    renderRouteFromState();
  }
  setStatus(DEFAULT_STATUS_MESSAGE, { sticky: true });

  function createMap() {
    const tileOptions = {
      crossOrigin: true,
      keepBuffer: 4,
      maxZoom: 19,
      updateWhenIdle: false,
    };

    const baseLayers = {
      satellite: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          ...tileOptions,
          attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        },
      ),
      streets: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        ...tileOptions,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }),
      terrain: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        {
          ...tileOptions,
          attribution: "Tiles &copy; Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors",
        },
      ),
    };

    const createdMap = L.map("map", {
      attributionControl: true,
      bearing: Number(currentView.bearing) || 0,
      rotate: true,
      rotateControl: {
        closeOnZeroBearing: false,
        position: "bottomright",
      },
      touchRotate: true,
      zoomAnimation: false,
      zoomControl: false,
    }).setView([currentView.lat, currentView.lng], currentView.zoom);

    baseLayers.streets.addTo(createdMap);
    createdMap._codexBaseLayers = baseLayers;
    createdMap._codexActiveLayer = "streets";
    switchBaseLayer(activeLayer, false, createdMap);

    L.control.zoom({ position: "bottomright" }).addTo(createdMap);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(createdMap);

    createdMap.on("mousemove", (event) => {
      updateCoordinate(event.latlng.lat, event.latlng.lng);
    });
    createdMap.on("moveend", () => {
      const center = createdMap.getCenter();
      currentView.lat = center.lat;
      currentView.lng = center.lng;
      currentView.zoom = clampZoom(createdMap.getZoom());
      updateCoordinate(center.lat, center.lng);
    });
    createdMap.on("rotate", () => {
      currentView.bearing = getMapBearing(createdMap);
      handleManualMapInterruption();
    });
    createdMap.on("dragstart zoomstart", handleManualMapInterruption);

    window.addEventListener("resize", () => createdMap.invalidateSize(false));
    window.requestAnimationFrame(() => createdMap.invalidateSize(false));

    return createdMap;
  }

  function bindEvents() {
    els.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = els.searchInput.value.trim();
      if (!query) {
        setStatus("Nhập địa điểm để tìm kiếm.");
        els.searchInput.focus();
        return;
      }
      searchPlaces(query);
    });

    els.previewRouteButton.addEventListener("click", previewRoute);
    els.clearRouteButton.addEventListener("click", clearRoute);
    els.swapRouteButton.addEventListener("click", swapRoutePoints);
    els.useMyLocationButton.addEventListener("click", fillRouteOriginWithLocation);
    els.useViewedPlaceButton.addEventListener("click", useCurrentViewAsDestination);
    els.locateButton.addEventListener("click", locateUser);
    els.followUserButton.addEventListener("click", toggleFollowUserMode);
    els.fullscreenButton.addEventListener("click", toggleMapFullscreen);
    els.shareButton.addEventListener("click", shareCurrentView);
    els.zoomVietnamButton.addEventListener("click", () => {
      clearRouteGeometry();
      invalidateMapLayout();
      map.fitBounds(VIETNAM_BOUNDS, { animate: false, padding: [24, 24] });
      setStatus("Đang xem toàn Việt Nam.", { temporary: true });
    });
    els.clearMarkersButton.addEventListener("click", () => {
      clearRouteGeometry();
      clearTemporaryMarkers();
      setStatus("Đã ẩn ghim tạm.", { temporary: true });
    });
    els.clearSavedButton.addEventListener("click", clearSavedPlaces);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    els.layerButtons.forEach((button) => {
      button.addEventListener("click", () => {
        switchBaseLayer(button.dataset.layer, true, map);
      });
    });

    els.travelModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        routeState.travelMode = normalizeTravelMode(button.dataset.travelMode);
        updateTravelModeButtons();
        if (routeState.active) {
          previewRoute();
        }
      });
    });

    [els.originInput, els.destinationInput].forEach((input) => {
      input.addEventListener("input", () => {
        delete input.dataset.routeQuery;
        setLiveLocationField(input, false);
        if (input === els.originInput) {
          stopLiveTrackingIfIdle();
        }
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          previewRoute();
        }
      });
    });
  }

  async function searchPlaces(query) {
    if (searchController) {
      searchController.abort();
    }
    searchController = new AbortController();

    setStatus("Đang tìm kiếm...");
    clearRouteGeometry();
    els.resultList.replaceChildren();

    try {
      const places = await lookupPlaces(query, searchController.signal);
      renderSearchResults(places);
      setStatus(places.length ? `${places.length} kết quả` : "Không tìm thấy địa điểm phù hợp.");
      if (places[0]) {
        focusPlace(places[0], false);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      setStatus("Không thể tìm kiếm lúc này.");
      showToast("Dịch vụ tìm kiếm chưa phản hồi.");
    }
  }

  async function lookupPlaces(query, signal) {
    const providers = [searchPhoton, searchNominatim];
    let lastError = null;

    for (const provider of providers) {
      try {
        const places = await provider(query, signal);
        if (places.length || provider === providers[providers.length - 1]) {
          return places;
        }
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError || new Error("Search providers failed");
  }

  async function searchPhoton(query, signal) {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "7");
    url.searchParams.set("lang", "vi");

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Photon failed: ${response.status}`);
    }
    const data = await response.json();
    return (data.features || [])
      .map(normalizePhotonFeature)
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  }

  async function searchNominatim(query, signal) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "7");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "vi");

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Nominatim failed: ${response.status}`);
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : [])
      .map(normalizeNominatimResult)
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  }

  function renderSearchResults(places) {
    els.resultList.replaceChildren();
    places.forEach((place) => {
      const item = document.createElement("li");
      item.className = "result-item";

      const placeButton = createPlaceButton(place);
      placeButton.addEventListener("click", () => focusPlace(place, true));

      const saveButton = document.createElement("button");
      saveButton.className = "result-action";
      saveButton.type = "button";
      saveButton.title = "Lưu ghim";
      saveButton.setAttribute("aria-label", `Lưu ${place.name}`);
      saveButton.innerHTML = '<i data-lucide="bookmark-plus" aria-hidden="true"></i>';
      saveButton.addEventListener("click", () => addSavedPlace(place));

      item.append(placeButton, saveButton);
      els.resultList.appendChild(item);
    });
    createIcons();
  }

  function normalizePhotonFeature(feature) {
    const properties = feature.properties || {};
    const [lng, lat] = feature.geometry?.coordinates || [];
    const streetLine = [properties.housenumber, properties.street].filter(Boolean).join(" ");
    const parts = [
      streetLine,
      properties.district,
      properties.city || properties.county,
      properties.state,
      properties.country,
    ].filter(Boolean);

    return {
      address: unique(parts).join(", ") || formatCoordinate(lat, lng),
      id: `${properties.osm_type || "place"}-${properties.osm_id || `${lat}-${lng}`}`,
      lat: Number(lat),
      lng: Number(lng),
      name:
        properties.name ||
        properties.street ||
        properties.city ||
        properties.county ||
        properties.state ||
        "Địa điểm",
    };
  }

  function normalizeNominatimResult(result) {
    const address = result.address || {};
    const displayName = result.display_name || "";
    const addressParts = [
      address.road || address.pedestrian || address.neighbourhood,
      address.suburb || address.quarter || address.city_district,
      address.city || address.town || address.village || address.county,
      address.state,
      address.country,
    ].filter(Boolean);

    return {
      address: unique(addressParts).join(", ") || displayName || formatCoordinate(result.lat, result.lon),
      id: `nominatim-${result.osm_type || "place"}-${result.osm_id || result.place_id}`,
      lat: Number(result.lat),
      lng: Number(result.lon),
      name: result.name || displayName.split(",")[0] || "Địa điểm",
    };
  }

  function focusPlace(place, openToast) {
    setRouteField(els.destinationInput, place);
    clearRouteGeometry();
    clearTemporaryMarkers();
    searchMarker = L.marker([place.lat, place.lng], {
      icon: markerIcon("search"),
      title: place.name,
    }).addTo(tempMarkerLayer);
    searchMarker.bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(place.address)}`);
    applyView({ lat: place.lat, lng: place.lng, zoom: Math.max(currentView.zoom, 15) }, { animate: false });
    if (openToast) {
      showToast("Đã mở vị trí trên bản đồ.");
    }
  }

  function locateUser() {
    if (!navigator.geolocation) {
      setStatus("Trình duyệt không hỗ trợ định vị.");
      return;
    }

    setStatus("Đang định vị...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { accuracy, latitude, longitude } = position.coords;
        clearTemporaryMarkers();
        clearRouteGeometry();
        locationMarker = L.marker([latitude, longitude], {
          icon: markerIcon("location"),
          title: "Vị trí hiện tại",
        }).addTo(tempMarkerLayer);
        locationMarker.bindPopup(
          `<strong>Vị trí hiện tại</strong><br>${escapeHtml(
            `${formatCoordinate(latitude, longitude)} · sai số khoảng ${Math.round(accuracy)}m`,
          )}`,
        );
        applyView({ lat: latitude, lng: longitude, zoom: 16 }, { animate: false });
        els.originInput.value = "Vị trí hiện tại";
        els.originInput.dataset.routeQuery = `${latitude},${longitude}`;
        setStatus("Đã định vị.", { temporary: true });
      },
      (error) => {
        const messages = {
          1: "Bạn chưa cấp quyền định vị.",
          2: "Không lấy được vị trí hiện tại.",
          3: "Định vị mất quá nhiều thời gian.",
        };
        setStatus(messages[error.code] || "Không thể định vị.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 10000,
      },
    );
  }

  function fillRouteOriginWithLocation() {
    if (!navigator.geolocation) {
      setStatus("Trình duyệt không hỗ trợ định vị.");
      return;
    }

    setStatus("Đang lấy vị trí làm điểm đi...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLiveLocationField(els.originInput, true);
        setFollowUserMode(true, { silent: true });
        applyLiveNavigationPosition(position, { forceFollow: true, keepVisible: true });
        startLiveNavigation();
        if (routeState.active) {
          previewRoute();
        } else {
          setStatus("Đã bật điểm đi theo vị trí hiện tại và bám theo bạn.", { temporary: true });
        }
      },
      (error) => {
        setLiveLocationField(els.originInput, false);
        setFollowUserMode(false, { silent: true });
        setStatus(getLocationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 10000,
      },
    );
  }

  function toggleFollowUserMode() {
    if (followUserMode) {
      setFollowUserMode(false);
      setStatus("Đã tắt bám theo vị trí.", { temporary: true });
      return;
    }

    if (!navigator.geolocation) {
      setStatus("Trình duyệt không hỗ trợ định vị.");
      return;
    }

    setStatus("Đang bật bám theo vị trí...");
    if (navigationLastLatLng) {
      setFollowUserMode(true);
      syncMapToLivePosition(navigationLastLatLng, navigationHeading, { forceZoom: true });
      startLiveNavigation();
      setStatus("Đang bám theo vị trí của bạn.", { temporary: true });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFollowUserMode(true);
        applyLiveNavigationPosition(position, { forceFollow: true, keepVisible: true });
        startLiveNavigation();
        setStatus("Đang bám theo vị trí của bạn.", { temporary: true });
      },
      (error) => {
        setFollowUserMode(false, { silent: true });
        setStatus(getLocationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      },
    );
  }

  function setFollowUserMode(enabled, options = {}) {
    followUserMode = Boolean(enabled);
    syncFollowUserButton();

    if (!followUserMode) {
      stopLiveTrackingIfIdle();
      if (!options.silent) {
        showToast("Đã tắt bám theo vị trí.");
      }
    }
  }

  function syncFollowUserButton() {
    if (!els.followUserButton) {
      return;
    }
    els.followUserButton.classList.toggle("active", followUserMode);
    els.followUserButton.setAttribute("aria-pressed", String(followUserMode));
    const label = followUserMode ? "Tắt bám theo vị trí của tôi" : "Bật bám theo vị trí của tôi";
    els.followUserButton.setAttribute("aria-label", label);
    els.followUserButton.title = label;
  }

  function handleManualMapInterruption() {
    if (!followUserMode || isProgrammaticMapUpdateActive()) {
      return;
    }
    setFollowUserMode(false, { silent: true });
    setStatus("Đã tắt bám theo vị trí để bạn tự điều khiển bản đồ.", { temporary: true });
  }

  function stopLiveTrackingIfIdle() {
    if (followUserMode || isLiveLocationField(els.originInput)) {
      return;
    }
    stopLiveNavigation();
  }

  function syncMapToLivePosition(latLng, heading, options = {}) {
    runProgrammaticMapUpdate(() => {
      const nextZoom = options.forceZoom ? Math.max(map.getZoom(), 16) : map.getZoom();
      map.setView(latLng, nextZoom, { animate: false });
      if (typeof map.setBearing === "function" && Number.isFinite(heading) && heading > 0) {
        map.setBearing(heading);
      }
    });
  }

  function runProgrammaticMapUpdate(callback) {
    suppressFollowInteractionUntil = Date.now() + 900;
    callback();
  }

  function isProgrammaticMapUpdateActive() {
    return Date.now() < suppressFollowInteractionUntil;
  }

  async function toggleMapFullscreen() {
    const mapArea = els.mapArea;
    if (!mapArea) {
      return;
    }

    if (document.fullscreenElement === mapArea) {
      await document.exitFullscreen();
      return;
    }

    if (document.body.classList.contains("map-expanded")) {
      document.body.classList.remove("map-expanded");
      handleFullscreenChange();
      return;
    }

    if (!mapArea.requestFullscreen) {
      document.body.classList.add("map-expanded");
      handleFullscreenChange();
      return;
    }

    try {
      await mapArea.requestFullscreen();
    } catch {
      document.body.classList.add("map-expanded");
      handleFullscreenChange();
    }
  }

  function handleFullscreenChange() {
    syncFullscreenButton();
    window.setTimeout(() => invalidateMapLayout(), 90);
  }

  function syncFullscreenButton() {
    if (!els.fullscreenButton) {
      return;
    }

    const isExpanded =
      document.fullscreenElement === els.mapArea || document.body.classList.contains("map-expanded");
    els.fullscreenButton.classList.toggle("active", isExpanded);
    els.fullscreenButton.setAttribute("aria-pressed", String(isExpanded));
    const label = isExpanded ? "Thu nhỏ bản đồ" : "Mở rộng bản đồ";
    const icon = isExpanded ? "minimize-2" : "maximize-2";
    els.fullscreenButton.setAttribute("aria-label", label);
    els.fullscreenButton.title = label;
    els.fullscreenButton.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
    createIcons();
  }

  function useCurrentViewAsDestination() {
    setRouteField(els.destinationInput, {
      address: formatCoordinate(currentView.lat, currentView.lng),
      lat: currentView.lat,
      lng: currentView.lng,
      name: "Đang xem",
    });
    if (routeState.active) {
      previewRoute();
    } else {
      showToast("Đã lấy vị trí đang xem làm điểm đến.");
    }
  }

  async function previewRoute() {
    const rawRoute = readRouteFormState();
    if (!rawRoute.origin || !rawRoute.destination) {
      setStatus("Cần nhập cả điểm đi và điểm đến.");
      return;
    }

    if (routeController) {
      routeController.abort();
    }
    routeController = new AbortController();

    setStatus("Đang tính tuyến đường...");

    try {
      const [originPoint, destinationPoint] = await Promise.all([
        resolveRoutePoint(els.originInput, routeController.signal),
        resolveRoutePoint(els.destinationInput, routeController.signal),
      ]);

      routeState = {
        active: true,
        destination: destinationPoint.query,
        destinationLabel: destinationPoint.label,
        destinationLat: destinationPoint.lat,
        destinationLng: destinationPoint.lng,
        origin: originPoint.query,
        originLabel: originPoint.label,
        originLat: originPoint.lat,
        originLng: originPoint.lng,
        travelMode: rawRoute.travelMode,
      };

      if (routeState.travelMode === "transit") {
        clearRouteLayers();
        drawRouteEndpoints(routeState);
        fitRouteBounds(routeState);
        updateRouteLink();
        setStatus("Công cộng hiện mở qua Google Maps.");
        return;
      }

      const routeData = await fetchRoute(routeState, routeController.signal);
      drawRouteGeometry(routeState, routeData);
      updateRouteLink();
      setStatus(`${formatDistance(routeData.distance)} · ${formatDuration(routeData.duration)}`);
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      setStatus("Không tính được tuyến đường.");
      showToast("Hãy thử đổi cách viết địa điểm hoặc chọn lại ghim.");
    }
  }

  async function fetchRoute(route, signal) {
    const candidates = TRAVEL_PROFILES[route.travelMode] || TRAVEL_PROFILES.driving;
    let lastError = null;

    for (const candidate of candidates) {
      const url = new URL(
        `${candidate.base}/route/v1/${candidate.profile}/${route.originLng},${route.originLat};${route.destinationLng},${route.destinationLat}`,
      );
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("overview", "full");
      url.searchParams.set("steps", "true");

      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`route failed ${response.status}`);
        }
        const data = await response.json();
        if (!data.routes?.length) {
          throw new Error("no routes");
        }
        return {
          distance: data.routes[0].distance,
          duration: data.routes[0].duration,
          geometry: data.routes[0].geometry,
        };
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError || new Error("route providers failed");
  }

  function drawRouteGeometry(route, routeData) {
    const latLngs = normalizeRouteGeometry(routeData.geometry);
    if (!latLngs.length) {
      throw new Error("route geometry empty");
    }

    clearRouteLayers();
    routeLatLngs = latLngs;
    if (isLiveLocationField(els.originInput)) {
      const progressLatLng = navigationLastLatLng || L.latLng(route.originLat, route.originLng);
      updateLiveRouteProgress(progressLatLng);
    } else {
      routeLine = L.polyline(latLngs, ROUTE_STYLE).addTo(routeGeometryLayer);
      drawRouteArrows(latLngs, route.travelMode);
    }
    const initialHeading = latLngs.length > 1 ? computeBearing(latLngs[0], latLngs[1]) : navigationHeading;
    drawRouteEndpoints(route, initialHeading);
    const bounds = L.latLngBounds(latLngs.map((point) => L.latLng(point[0], point[1])));
    invalidateMapLayout();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { animate: false, padding: [48, 48] });
    }
  }

  function drawRouteEndpoints(route, liveHeading = navigationHeading) {
    routeMarkerLayer.clearLayers();
    if (isLiveLocationField(els.originInput)) {
      renderNavigationMarker([route.originLat, route.originLng], liveHeading);
    } else {
      clearNavigationMarker();
      L.marker([route.originLat, route.originLng], {
        icon: markerIcon("origin"),
        title: route.originLabel || "Điểm đi",
      }).addTo(routeMarkerLayer);
    }
    L.marker([route.destinationLat, route.destinationLng], {
      icon: markerIcon("destination"),
      title: route.destinationLabel || "Điểm đến",
    }).addTo(routeMarkerLayer);
  }

  function fitRouteBounds(route) {
    invalidateMapLayout();
    const bounds = L.latLngBounds(
      [route.originLat, route.originLng],
      [route.destinationLat, route.destinationLng],
    );
    map.fitBounds(bounds, { animate: false, padding: [48, 48] });
  }

  function clearRoute() {
    if (routeController) {
      routeController.abort();
    }
    routeState = { ...DEFAULT_ROUTE, travelMode: routeState.travelMode };
    els.originInput.value = "";
    els.destinationInput.value = "";
    delete els.originInput.dataset.routeQuery;
    delete els.destinationInput.dataset.routeQuery;
    setLiveLocationField(els.originInput, false);
    setLiveLocationField(els.destinationInput, false);
    stopLiveTrackingIfIdle();
    clearRouteGeometry();
    setStatus("Đã xóa tuyến đường.", { temporary: true });
  }

  function clearRouteLayers() {
    routeGeometryLayer.clearLayers();
    routeMarkerLayer.clearLayers();
    rerouteInFlight = false;
    rerouteCooldownUntil = 0;
    routeLatLngs = [];
    routeLine = null;
    routeTraveledLine = null;
  }

  function clearRouteGeometry() {
    clearRouteLayers();
    routeState.active = false;
    updateRouteLink();
  }

  function swapRoutePoints() {
    const originLabel = els.originInput.value;
    const originQuery = els.originInput.dataset.routeQuery || "";
    const originLive = isLiveLocationField(els.originInput);
    const destinationLabel = els.destinationInput.value;
    const destinationQuery = els.destinationInput.dataset.routeQuery || "";
    const destinationLive = isLiveLocationField(els.destinationInput);

    els.originInput.value = destinationLabel;
    els.destinationInput.value = originLabel;
    setRouteQueryDataset(els.originInput, destinationQuery);
    setRouteQueryDataset(els.destinationInput, originQuery);
    setLiveLocationField(els.originInput, destinationLive);
    setLiveLocationField(els.destinationInput, originLive);

    if (destinationLive) {
      startLiveNavigation();
    } else {
      stopLiveTrackingIfIdle();
    }

    if (routeState.active) {
      const oldOriginLat = routeState.originLat;
      const oldOriginLng = routeState.originLng;
      const oldDestinationLat = routeState.destinationLat;
      const oldDestinationLng = routeState.destinationLng;
      routeState.origin = destinationQuery;
      routeState.originLabel = destinationLabel;
      routeState.originLat = oldDestinationLat;
      routeState.originLng = oldDestinationLng;
      routeState.destination = originQuery;
      routeState.destinationLabel = originLabel;
      routeState.destinationLat = oldOriginLat;
      routeState.destinationLng = oldOriginLng;
      previewRoute();
    }
  }

  function switchBaseLayer(layerName, updateView, targetMap) {
    const baseLayers = targetMap._codexBaseLayers;
    if (!baseLayers[layerName] || targetMap._codexActiveLayer === layerName) {
      return;
    }

    targetMap.removeLayer(baseLayers[targetMap._codexActiveLayer]);
    baseLayers[layerName].addTo(targetMap);
    targetMap._codexActiveLayer = layerName;
    activeLayer = layerName;
    currentView.layer = layerName;
    updateLayerButtons();

    if (updateView) {
      setStatus("Đã đổi lớp bản đồ.", { temporary: true });
    }
  }

  function applyView(nextView, options) {
    currentView = {
      ...currentView,
      ...nextView,
      bearing: normalizeBearing(nextView.bearing ?? currentView.bearing),
      lat: Number.isFinite(Number(nextView.lat)) ? Number(nextView.lat) : currentView.lat,
      lng: Number.isFinite(Number(nextView.lng)) ? Number(nextView.lng) : currentView.lng,
      zoom: clampZoom(Number(nextView.zoom ?? currentView.zoom)),
    };
    map.setView([currentView.lat, currentView.lng], currentView.zoom, { animate: false, ...options });
    if (typeof map.setBearing === "function") {
      map.setBearing(currentView.bearing);
    }
    updateCoordinate(currentView.lat, currentView.lng);
  }

  function updateLayerButtons() {
    els.layerButtons.forEach((button) => {
      const active = button.dataset.layer === activeLayer;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function addSavedPlace(place) {
    const normalized = {
      address: place.address || formatCoordinate(place.lat, place.lng),
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      lat: Number(place.lat),
      lng: Number(place.lng),
      name: place.name || "Ghim đã lưu",
    };

    const exists = savedPlaces.some(
      (saved) =>
        Math.abs(saved.lat - normalized.lat) < 0.00001 &&
        Math.abs(saved.lng - normalized.lng) < 0.00001 &&
        saved.name === normalized.name,
    );
    if (exists) {
      showToast("Ghim này đã có trong danh sách.");
      return;
    }

    savedPlaces.unshift(normalized);
    saveSavedPlaces();
    renderSavedPlaces();
    showToast("Đã lưu ghim.");
  }

  function removeSavedPlace(id) {
    const index = savedPlaces.findIndex((place) => place.id === id);
    if (index === -1) {
      return;
    }
    savedPlaces.splice(index, 1);
    saveSavedPlaces();
    renderSavedPlaces();
  }

  function clearSavedPlaces() {
    if (!savedPlaces.length) {
      showToast("Chưa có ghim để xóa.");
      return;
    }

    savedPlaces.length = 0;
    saveSavedPlaces();
    renderSavedPlaces();
    showToast("Đã xóa tất cả ghim.");
  }

  function renderSavedPlaces() {
    savedMarkerLayer.clearLayers();
    els.savedList.replaceChildren();

    if (!savedPlaces.length) {
      const empty = document.createElement("li");
      empty.innerHTML = '<p class="empty-state">Chưa có ghim nào.</p>';
      els.savedList.appendChild(empty);
      return;
    }

    savedPlaces.forEach((place) => {
      const marker = L.marker([place.lat, place.lng], {
        icon: markerIcon("saved"),
        title: place.name,
      }).addTo(savedMarkerLayer);
      marker.bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(place.address)}`);

      const item = document.createElement("li");
      item.className = "saved-item";

      const placeButton = createPlaceButton(place);
      placeButton.addEventListener("click", () => focusPlace(place, true));

      const removeButton = document.createElement("button");
      removeButton.className = "result-action";
      removeButton.type = "button";
      removeButton.title = "Xóa ghim";
      removeButton.setAttribute("aria-label", `Xóa ${place.name}`);
      removeButton.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      removeButton.addEventListener("click", () => removeSavedPlace(place.id));

      item.append(placeButton, removeButton);
      els.savedList.appendChild(item);
    });
    createIcons();
  }

  function createPlaceButton(place) {
    const button = document.createElement("button");
    button.className = "place-button";
    button.type = "button";

    const title = document.createElement("span");
    title.className = "place-title";
    title.textContent = place.name;

    const meta = document.createElement("span");
    meta.className = "place-meta";
    meta.textContent = place.address || formatCoordinate(place.lat, place.lng);

    button.append(title, meta);
    return button;
  }

  async function shareCurrentView() {
    const center = map.getCenter();
    const params = new URLSearchParams({
      b: String(normalizeBearing(getMapBearing(map))),
      lat: center.lat.toFixed(6),
      layer: activeLayer,
      lng: center.lng.toFixed(6),
      z: String(clampZoom(map.getZoom())),
    });

    if (routeState.active && routeState.origin && routeState.destination) {
      params.set("route", "1");
      params.set("origin", routeState.origin);
      params.set("originLabel", routeState.originLabel || routeState.origin);
      params.set("destination", routeState.destination);
      params.set("destinationLabel", routeState.destinationLabel || routeState.destination);
      params.set("travelMode", routeState.travelMode);
      if (hasResolvedCoordinates(routeState)) {
        params.set("originLat", String(routeState.originLat));
        params.set("originLng", String(routeState.originLng));
        params.set("destinationLat", String(routeState.destinationLat));
        params.set("destinationLng", String(routeState.destinationLng));
      }
    }

    const link = new URL(window.location.href);
    link.hash = params.toString();

    try {
      await copyToClipboard(link.href);
      showToast("Đã sao chép liên kết bản đồ.");
    } catch {
      setStatus("Không thể sao chép tự động.", { temporary: true });
      showToast("Không thể sao chép tự động.");
    }
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {}
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("copy failed");
    }
  }

  function readSharedView() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      bearing: normalizeBearing(Number(params.get("b") || DEFAULT_VIEW.bearing)),
      lat,
      layer: params.get("layer") || DEFAULT_VIEW.layer,
      lng,
      zoom: clampZoom(Number(params.get("z") || DEFAULT_VIEW.zoom)),
    };
  }

  function readSharedRoute() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.get("route") !== "1") {
      return null;
    }

    const origin = params.get("origin") || "";
    const destination = params.get("destination") || "";
    if (!origin || !destination) {
      return null;
    }

    return {
      active: true,
      destination,
      destinationLabel: params.get("destinationLabel") || destination,
      destinationLat: Number(params.get("destinationLat")),
      destinationLng: Number(params.get("destinationLng")),
      origin,
      originLabel: params.get("originLabel") || origin,
      originLat: Number(params.get("originLat")),
      originLng: Number(params.get("originLng")),
      travelMode: normalizeTravelMode(params.get("travelMode")),
    };
  }

  function loadSavedPlaces() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
        : [];
    } catch {
      return [];
    }
  }

  function saveSavedPlaces() {
    localStorage.setItem(STORE_KEY, JSON.stringify(savedPlaces.slice(0, 100)));
  }

  function readRouteFormState() {
    return {
      destination: getRouteFieldValue(els.destinationInput),
      destinationLabel: els.destinationInput.value.trim(),
      origin: getRouteFieldValue(els.originInput),
      originLabel: els.originInput.value.trim(),
      travelMode: normalizeTravelMode(routeState.travelMode),
    };
  }

  async function resolveRoutePoint(input, signal) {
    const rawValue = getRouteFieldValue(input);
    const label = input.value.trim() || rawValue;
    const parsed = parseCoordinateString(rawValue) || parseCoordinateString(label);
    if (parsed) {
      const query = `${parsed.lat},${parsed.lng}`;
      setRouteQueryDataset(input, query);
      return {
        label: label || formatCoordinate(parsed.lat, parsed.lng),
        lat: parsed.lat,
        lng: parsed.lng,
        query,
      };
    }

    const places = await lookupPlaces(rawValue, signal);
    if (!places.length) {
      throw new Error("route geocode failed");
    }

    const place = places[0];
    setRouteField(input, place);
    return {
      label: input.value.trim() || place.name,
      lat: place.lat,
      lng: place.lng,
      query: `${place.lat},${place.lng}`,
    };
  }

  function parseCoordinateString(value) {
    if (!value) {
      return null;
    }

    const match = String(value)
      .trim()
      .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      return null;
    }

    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return { lat, lng };
  }

  function setStatus(message, options = {}) {
    window.clearTimeout(statusTimer);
    els.searchStatus.textContent = message;

    if (options.sticky || !options.temporary) {
      return;
    }

    statusTimer = window.setTimeout(() => {
      els.searchStatus.textContent = options.fallback || DEFAULT_STATUS_MESSAGE;
    }, options.duration ?? 2400);
  }

  function updateCoordinate(lat, lng) {
    const value = formatCoordinate(lat, lng);
    els.coordinateReadout.value = value;
    els.coordinateReadout.textContent = value;
  }

  function updateTravelModeButtons() {
    els.travelModeButtons.forEach((button) => {
      const active = button.dataset.travelMode === routeState.travelMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function syncRouteInputs() {
    if (!routeState.origin && !routeState.destination) {
      return;
    }
    els.originInput.value = routeState.originLabel || routeState.origin;
    els.destinationInput.value = routeState.destinationLabel || routeState.destination;
    setRouteQueryDataset(els.originInput, routeState.origin);
    setRouteQueryDataset(els.destinationInput, routeState.destination);
  }

  function updateRouteLink() {
    const canOpen = routeState.active && routeState.origin && routeState.destination;
    els.openDirectionsLink.classList.toggle("hidden", !canOpen);
    els.openDirectionsLink.href = canOpen ? buildDirectionsExternalUrl(routeState) : "#";
    els.openDirectionsLink.textContent =
      routeState.travelMode === "transit" ? "Mở chỉ đường trong Google Maps" : "Mở chỉ đường toàn màn hình";
  }

  function buildDirectionsExternalUrl(route) {
    if (route.travelMode === "transit" || !hasResolvedCoordinates(route)) {
      const url = new URL("https://www.google.com/maps/dir/");
      url.searchParams.set("api", "1");
      url.searchParams.set("origin", route.origin);
      url.searchParams.set("destination", route.destination);
      url.searchParams.set("travelmode", route.travelMode);
      url.searchParams.set("hl", "vi");
      return url.toString();
    }

    const profile =
      route.travelMode === "walking"
        ? "fossgis_osrm_foot"
        : route.travelMode === "bicycling"
          ? "fossgis_osrm_bike"
          : "fossgis_osrm_car";
    const url = new URL("https://www.openstreetmap.org/directions");
    url.searchParams.set("engine", profile);
    url.searchParams.set("route", `${route.originLat},${route.originLng};${route.destinationLat},${route.destinationLng}`);
    url.hash = `map=${Math.max(currentView.zoom, 11)}/${(
      (route.originLat + route.destinationLat) /
      2
    ).toFixed(5)}/${(((route.originLng + route.destinationLng) / 2).toFixed(5))}`;
    return url.toString();
  }

  function renderRouteFromState() {
    clearRouteLayers();
    drawRouteEndpoints(routeState);
    if (routeState.travelMode === "transit") {
      fitRouteBounds(routeState);
      updateRouteLink();
      setStatus("Chỉ đường công cộng sẵn sàng mở ngoài.");
      return;
    }
    previewRoute();
  }

  function clearTemporaryMarkers() {
    tempMarkerLayer.clearLayers();
    searchMarker = null;
    locationMarker = null;
  }

  function markerIcon(type) {
    return L.divIcon({
      className: `map-pin pin-${type}`,
      iconAnchor: [15, 30],
      iconSize: [30, 30],
      popupAnchor: [0, -28],
    });
  }

  function routeArrowIcon(angle) {
    return L.divIcon({
      className: "route-arrow-marker",
      html: `<span class="route-arrow-glyph" style="--route-arrow-rotation:${angle}deg"></span>`,
      iconAnchor: [ROUTE_ARROW_SIZE / 2, ROUTE_ARROW_SIZE / 2],
      iconSize: [ROUTE_ARROW_SIZE, ROUTE_ARROW_SIZE],
    });
  }

  function navigationArrowIcon(angle) {
    return L.divIcon({
      className: "navigation-arrow-marker",
      html: `<span class="navigation-arrow-glyph" style="--navigation-arrow-rotation:${angle}deg"></span>`,
      iconAnchor: [NAVIGATION_ARROW_SIZE / 2, NAVIGATION_ARROW_SIZE / 2],
      iconSize: [NAVIGATION_ARROW_SIZE, NAVIGATION_ARROW_SIZE],
    });
  }

  function setRouteField(input, place) {
    input.value = place.name || place.address || formatCoordinate(place.lat, place.lng);
    input.dataset.routeQuery =
      Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng))
        ? `${place.lat},${place.lng}`
        : place.address || place.name || "";
    setLiveLocationField(input, false);
    if (input === els.originInput) {
      stopLiveTrackingIfIdle();
    }
  }

  function getRouteFieldValue(input) {
    return (input.dataset.routeQuery || input.value || "").trim();
  }

  function setRouteQueryDataset(input, value) {
    if (value) {
      input.dataset.routeQuery = value;
      return;
    }
    delete input.dataset.routeQuery;
  }

  function setLiveLocationField(input, enabled) {
    if (enabled) {
      input.dataset.liveLocation = "1";
      return;
    }
    delete input.dataset.liveLocation;
  }

  function isLiveLocationField(input) {
    return input.dataset.liveLocation === "1";
  }

  function normalizeTravelMode(mode) {
    return mode === "transit" || TRAVEL_PROFILES[mode] ? mode : DEFAULT_ROUTE.travelMode;
  }

  function normalizeRouteGeometry(geometry) {
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
    return coordinates
      .map((point) => {
        const [lng, lat] = Array.isArray(point) ? point : [];
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
      })
      .filter(Boolean);
  }

  function drawRouteArrows(latLngs, travelMode) {
    const arrowPoints = sampleRouteArrowPoints(latLngs, travelMode);
    arrowPoints.forEach((point) => {
      L.marker(point.latLng, {
        icon: routeArrowIcon(point.angle),
        interactive: false,
        keyboard: false,
        zIndexOffset: -10,
      }).addTo(routeGeometryLayer);
    });
  }

  function sampleRouteArrowPoints(latLngs, travelMode) {
    if (latLngs.length < 2) {
      return [];
    }

    const totalDistance = measurePolylineDistance(latLngs);
    if (totalDistance < 240) {
      return [];
    }

    const baseSpacing =
      travelMode === "walking" ? 450 : travelMode === "bicycling" ? 700 : 950;
    const arrowCount = Math.max(1, Math.min(10, Math.round(totalDistance / baseSpacing)));
    const spacing = totalDistance / (arrowCount + 1);
    const points = [];
    let traversed = 0;
    let targetDistance = spacing;

    for (let index = 1; index < latLngs.length && points.length < arrowCount; index += 1) {
      const start = latLngs[index - 1];
      const end = latLngs[index];
      const segmentDistance = distanceBetweenPoints(start, end);
      if (segmentDistance <= 0) {
        continue;
      }

      while (traversed + segmentDistance >= targetDistance && points.length < arrowCount) {
        const ratio = (targetDistance - traversed) / segmentDistance;
        const lat = start[0] + (end[0] - start[0]) * ratio;
        const lng = start[1] + (end[1] - start[1]) * ratio;
        points.push({
          angle: computeBearing(start, end),
          latLng: [lat, lng],
        });
        targetDistance += spacing;
      }

      traversed += segmentDistance;
    }

    return points;
  }

  function updateLiveRouteProgress(currentLatLng) {
    if (
      !routeState.active ||
      routeState.travelMode === "transit" ||
      !isLiveLocationField(els.originInput) ||
      routeLatLngs.length < 2
    ) {
      return;
    }

    const progress = projectPointOntoRoute(
      [currentLatLng.lat, currentLatLng.lng],
      routeLatLngs,
    );
    if (!progress) {
      return;
    }

    const { remainingLatLngs, traveledLatLngs } = splitRouteAtProgress(routeLatLngs, progress);
    routeGeometryLayer.clearLayers();
    routeTraveledLine = null;
    routeLine = null;

    if (traveledLatLngs.length >= 2) {
      routeTraveledLine = L.polyline(traveledLatLngs, ROUTE_TRAVELED_STYLE).addTo(routeGeometryLayer);
    }

    if (remainingLatLngs.length >= 2) {
      routeLine = L.polyline(remainingLatLngs, ROUTE_STYLE).addTo(routeGeometryLayer);
    } else if (remainingLatLngs.length === 1 && traveledLatLngs.length >= 2) {
      routeLine = L.polyline(
        [traveledLatLngs[traveledLatLngs.length - 1], remainingLatLngs[0]],
        ROUTE_STYLE,
      ).addTo(routeGeometryLayer);
    }
  }

  function splitRouteAtProgress(latLngs, progress) {
    const projectedLatLng = progress.latLng;
    const traveledLatLngs = latLngs.slice(0, progress.segmentStartIndex + 1);
    const remainingLatLngs = latLngs.slice(progress.segmentStartIndex + 1);

    if (!isSameLatLng(traveledLatLngs[traveledLatLngs.length - 1], projectedLatLng)) {
      traveledLatLngs.push(projectedLatLng);
    }

    if (!remainingLatLngs.length || !isSameLatLng(remainingLatLngs[0], projectedLatLng)) {
      remainingLatLngs.unshift(projectedLatLng);
    }

    return {
      remainingLatLngs: dedupeLatLngs(remainingLatLngs),
      traveledLatLngs: dedupeLatLngs(traveledLatLngs),
    };
  }

  function projectPointOntoRoute(point, latLngs) {
    let bestProjection = null;

    for (let index = 1; index < latLngs.length; index += 1) {
      const start = normalizeLatLngPair(latLngs[index - 1]);
      const end = normalizeLatLngPair(latLngs[index]);
      const projection = projectPointOntoSegmentMeters(point, start, end);
      if (!bestProjection || projection.distanceMeters < bestProjection.distanceMeters) {
        bestProjection = {
          ...projection,
          segmentStartIndex: index - 1,
        };
      }
    }

    return bestProjection;
  }

  function projectPointOntoSegmentMeters(point, start, end) {
    const referenceLat = toRadians((point[0] + start[0] + end[0]) / 3);
    const projectedPoint = projectLatLngToMeters(point, referenceLat);
    const projectedStart = projectLatLngToMeters(start, referenceLat);
    const projectedEnd = projectLatLngToMeters(end, referenceLat);
    const segmentX = projectedEnd.x - projectedStart.x;
    const segmentY = projectedEnd.y - projectedStart.y;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

    if (segmentLengthSquared === 0) {
      return {
        distanceMeters: Math.hypot(projectedPoint.x - projectedStart.x, projectedPoint.y - projectedStart.y),
        latLng: [start[0], start[1]],
        ratio: 0,
      };
    }

    const projection =
      ((projectedPoint.x - projectedStart.x) * segmentX + (projectedPoint.y - projectedStart.y) * segmentY) /
      segmentLengthSquared;
    const ratio = Math.min(1, Math.max(0, projection));
    const closestX = projectedStart.x + segmentX * ratio;
    const closestY = projectedStart.y + segmentY * ratio;

    return {
      distanceMeters: Math.hypot(projectedPoint.x - closestX, projectedPoint.y - closestY),
      latLng: [
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ],
      ratio,
    };
  }

  function dedupeLatLngs(latLngs) {
    return latLngs.filter((point, index) => index === 0 || !isSameLatLng(point, latLngs[index - 1]));
  }

  function isSameLatLng(left, right) {
    if (!left || !right) {
      return false;
    }
    const [leftLat, leftLng] = normalizeLatLngPair(left);
    const [rightLat, rightLng] = normalizeLatLngPair(right);
    return Math.abs(leftLat - rightLat) < 0.000001 && Math.abs(leftLng - rightLng) < 0.000001;
  }

  function startLiveNavigation() {
    if (navigationWatchId != null || !navigator.geolocation) {
      return;
    }

    navigationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        applyLiveNavigationPosition(position, { keepVisible: routeState.active });
      },
      (error) => {
        stopLiveNavigation();
        setLiveLocationField(els.originInput, false);
        setFollowUserMode(false, { silent: true });
        setStatus(getLocationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1500,
        timeout: 10000,
      },
    );
  }

  function stopLiveNavigation() {
    if (navigationWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(navigationWatchId);
    }
    navigationWatchId = null;
    navigationLastLatLng = null;
    navigationHeading = 0;
    rerouteInFlight = false;
    rerouteCooldownUntil = 0;
    clearNavigationMarker();
  }

  function applyLiveNavigationPosition(position, options = {}) {
    const { heading, latitude, longitude } = position.coords;
    const nextLatLng = L.latLng(latitude, longitude);
    let nextHeading = Number.isFinite(heading) && heading >= 0 ? heading : navigationHeading;

    if ((!Number.isFinite(nextHeading) || nextHeading === 0) && navigationLastLatLng) {
      nextHeading = computeBearing(
        [navigationLastLatLng.lat, navigationLastLatLng.lng],
        [nextLatLng.lat, nextLatLng.lng],
      );
    }

    navigationLastLatLng = nextLatLng;
    navigationHeading = Number.isFinite(nextHeading) ? nextHeading : 0;

    if (isLiveLocationField(els.originInput)) {
      const query = `${latitude},${longitude}`;
      els.originInput.value = "Vị trí hiện tại";
      setRouteQueryDataset(els.originInput, query);
      routeState.origin = query;
      routeState.originLabel = "Vị trí hiện tại";
      routeState.originLat = latitude;
      routeState.originLng = longitude;
      updateRouteLink();
    }

    renderNavigationMarker([latitude, longitude], navigationHeading);
    updateLiveRouteProgress(nextLatLng);

    if (followUserMode || options.forceFollow) {
      syncMapToLivePosition(nextLatLng, navigationHeading, {
        forceZoom: options.forceFollow || !routeState.active,
      });
    } else if (options.keepVisible) {
      keepNavigationMarkerVisible(nextLatLng);
    }

    maybeAutoRerouteFromLivePosition(nextLatLng);
  }

  function renderNavigationMarker(latLng, heading = 0) {
    if (!navigationMarker) {
      navigationMarker = L.marker(latLng, {
        icon: navigationArrowIcon(heading),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1400,
        title: "Vị trí hiện tại",
      }).addTo(navigationLayer);
      return;
    }

    navigationMarker.setLatLng(latLng);
    navigationMarker.setIcon(navigationArrowIcon(heading));
  }

  function clearNavigationMarker() {
    navigationLayer.clearLayers();
    navigationMarker = null;
  }

  function keepNavigationMarkerVisible(latLng) {
    const visibleBounds = map.getBounds();
    if (!visibleBounds.isValid()) {
      return;
    }

    const safeBounds = visibleBounds.pad(-0.18);
    if (!safeBounds.isValid() || !safeBounds.contains(latLng)) {
      map.panTo(latLng, { animate: true, duration: 0.7 });
    }
  }

  function maybeAutoRerouteFromLivePosition(currentLatLng) {
    if (!routeState.active || routeState.travelMode === "transit" || !isLiveLocationField(els.originInput)) {
      return;
    }

    if (!hasResolvedCoordinates(routeState) || routeLatLngs.length < 2 || rerouteInFlight) {
      return;
    }

    const now = Date.now();
    if (now < rerouteCooldownUntil) {
      return;
    }

    const remainingDistance = map.distance(
      currentLatLng,
      L.latLng(routeState.destinationLat, routeState.destinationLng),
    );
    if (remainingDistance <= ARRIVAL_RADIUS_METERS) {
      return;
    }

    const offRouteDistance = distanceToRouteMeters(
      [currentLatLng.lat, currentLatLng.lng],
      routeLatLngs,
    );
    const rerouteThreshold = getRerouteThreshold(routeState.travelMode);
    if (offRouteDistance <= rerouteThreshold) {
      return;
    }

    rerouteCooldownUntil = now + REROUTE_COOLDOWN_MS;
    rerouteActiveRouteFromPosition(currentLatLng, offRouteDistance);
  }

  async function rerouteActiveRouteFromPosition(currentLatLng, offRouteDistance) {
    if (rerouteInFlight) {
      return;
    }

    rerouteInFlight = true;
    if (routeController) {
      routeController.abort();
    }
    routeController = new AbortController();

    const nextRoute = {
      ...routeState,
      origin: `${currentLatLng.lat},${currentLatLng.lng}`,
      originLabel: "Vị trí hiện tại",
      originLat: currentLatLng.lat,
      originLng: currentLatLng.lng,
    };

    try {
      setStatus(`Bạn đang lệch tuyến khoảng ${Math.round(offRouteDistance)}m, đang cập nhật...`);
      const routeData = await fetchRoute(nextRoute, routeController.signal);
      routeState = nextRoute;
      drawRouteGeometry(routeState, routeData);
      updateRouteLink();
      setStatus(`Đã cập nhật tuyến · ${formatDistance(routeData.distance)} · ${formatDuration(routeData.duration)}`);
    } catch (error) {
      if (error.name !== "AbortError") {
        setStatus("Chưa cập nhật lại được tuyến.");
      }
    } finally {
      rerouteInFlight = false;
    }
  }

  function distanceToRouteMeters(point, latLngs) {
    let shortestDistance = Infinity;

    for (let index = 1; index < latLngs.length; index += 1) {
      const start = normalizeLatLngPair(latLngs[index - 1]);
      const end = normalizeLatLngPair(latLngs[index]);
      const segmentDistance = distancePointToSegmentMeters(point, start, end);
      if (segmentDistance < shortestDistance) {
        shortestDistance = segmentDistance;
      }
    }

    return shortestDistance;
  }

  function distancePointToSegmentMeters(point, start, end) {
    const referenceLat = toRadians((point[0] + start[0] + end[0]) / 3);
    const projectedPoint = projectLatLngToMeters(point, referenceLat);
    const projectedStart = projectLatLngToMeters(start, referenceLat);
    const projectedEnd = projectLatLngToMeters(end, referenceLat);
    const segmentX = projectedEnd.x - projectedStart.x;
    const segmentY = projectedEnd.y - projectedStart.y;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

    if (segmentLengthSquared === 0) {
      return Math.hypot(projectedPoint.x - projectedStart.x, projectedPoint.y - projectedStart.y);
    }

    const projection =
      ((projectedPoint.x - projectedStart.x) * segmentX + (projectedPoint.y - projectedStart.y) * segmentY) /
      segmentLengthSquared;
    const clampedProjection = Math.min(1, Math.max(0, projection));
    const closestX = projectedStart.x + segmentX * clampedProjection;
    const closestY = projectedStart.y + segmentY * clampedProjection;
    return Math.hypot(projectedPoint.x - closestX, projectedPoint.y - closestY);
  }

  function projectLatLngToMeters(point, referenceLat) {
    const earthRadius = 6371000;
    return {
      x: earthRadius * toRadians(point[1]) * Math.cos(referenceLat),
      y: earthRadius * toRadians(point[0]),
    };
  }

  function normalizeLatLngPair(point) {
    if (Array.isArray(point)) {
      return [Number(point[0]), Number(point[1])];
    }
    return [Number(point.lat), Number(point.lng)];
  }

  function getRerouteThreshold(travelMode) {
    if (travelMode === "walking") {
      return 35;
    }
    if (travelMode === "bicycling") {
      return 45;
    }
    return 60;
  }

  function measurePolylineDistance(latLngs) {
    return latLngs.reduce((total, point, index) => {
      if (index === 0) {
        return total;
      }
      return total + distanceBetweenPoints(latLngs[index - 1], point);
    }, 0);
  }

  function distanceBetweenPoints(start, end) {
    return map.distance(L.latLng(start[0], start[1]), L.latLng(end[0], end[1]));
  }

  function computeBearing(start, end) {
    const startLat = toRadians(start[0]);
    const startLng = toRadians(start[1]);
    const endLat = toRadians(end[0]);
    const endLng = toRadians(end[1]);
    const y = Math.sin(endLng - startLng) * Math.cos(endLat);
    const x =
      Math.cos(startLat) * Math.sin(endLat) -
      Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function getLocationErrorMessage(error) {
    const messages = {
      1: "Bạn chưa cấp quyền định vị.",
      2: "Không lấy được vị trí hiện tại.",
      3: "Định vị mất quá nhiều thời gian.",
    };
    return messages[error?.code] || "Không thể định vị.";
  }

  function invalidateMapLayout() {
    map.invalidateSize(false);
  }

  function getMapBearing(targetMap) {
    return typeof targetMap?.getBearing === "function" ? normalizeBearing(targetMap.getBearing()) : 0;
  }

  function hasResolvedCoordinates(route) {
    return (
      Number.isFinite(route.originLat) &&
      Number.isFinite(route.originLng) &&
      Number.isFinite(route.destinationLat) &&
      Number.isFinite(route.destinationLng)
    );
  }

  function formatCoordinate(lat, lng) {
    return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  }

  function formatDistance(distanceInMeters) {
    if (distanceInMeters >= 1000) {
      return `${(distanceInMeters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(distanceInMeters)} m`;
  }

  function formatDuration(durationInSeconds) {
    const minutes = Math.round(durationInSeconds / 60);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remain = minutes % 60;
      return remain ? `${hours} giờ ${remain} phút` : `${hours} giờ`;
    }
    return `${minutes} phút`;
  }

  function clampZoom(zoom) {
    if (!Number.isFinite(zoom)) {
      return DEFAULT_VIEW.zoom;
    }
    return Math.min(Math.max(Math.round(zoom), 3), 19);
  }

  function normalizeBearing(value) {
    if (!Number.isFinite(Number(value))) {
      return DEFAULT_VIEW.bearing;
    }
    const normalized = Number(value) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  function unique(items) {
    return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function createIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function showToast(message) {
    let toast = $(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(routeToastTimer);
    routeToastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
  }
})();
