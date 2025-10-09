const browser = globalThis.browser || globalThis.chrome;

let customEndpointUrl = "";
let savedCustomEndpoints = [];
let extractedSchedule = [];
let extractedSelf = null;
let extractedUsers = [];
let icsContent = "";
let apiData = {};
let selectedApiEndpoint = "";
let isConnecting = false;

const API_ENDPOINTS = {
	scheduleData: "/api/crispnow",
	users: "/api/users",
	self: "/api/users",
};

let availableDataTypes = [];

document.addEventListener("DOMContentLoaded", function () {
	const status = document.getElementById("status");
	const apiEndpointSelect = document.getElementById("apiEndpointSelect");
	const customEndpointInput = document.getElementById("customEndpointInput");
	const connectBtn = document.getElementById("connectBtn");
	const refreshBtn = document.getElementById("refreshBtn");
	const selfBtn = document.getElementById("selfBtn");
	const extractBtn = document.getElementById("extractBtn");
	const extractionType = document.getElementById("extractionType");
	const weeksInput = document.getElementById("weeksInput");
	const weeksContainer = document.getElementById("weeksContainer");
	const downloadBtn = document.getElementById("downloadBtn");
	const copyApiBtn = document.getElementById("copyApiBtn");
	const postApiBtn = document.getElementById("postApiBtn");
	const clearCacheBtn = document.getElementById("clearCacheBtn");
	const dataSelection = document.getElementById("dataSelection");
	const dataTypeSelect = document.getElementById("dataTypeSelect");
	const schedulePreview = document.getElementById("schedulePreview");

	apiEndpointSelect.addEventListener("change", handleEndpointChange);
	customEndpointInput.addEventListener("input", handleCustomEndpointInput);
	connectBtn.addEventListener("click", handleConnect);
	refreshBtn.addEventListener("click", refreshConnection);
	selfBtn.addEventListener("click", extractSelf);
	extractBtn.addEventListener("click", handleExtraction);
	extractionType.addEventListener("change", handleExtractionTypeChange);
	weeksInput.addEventListener("input", updateExtractButtonText);
	downloadBtn.addEventListener("click", downloadICS);
	copyApiBtn.addEventListener("click", copyApiData);
	postApiBtn.addEventListener("click", postToAPI);
	clearCacheBtn.addEventListener("click", clearCachedData);

	console.log("[POPUP] Event listeners attached");

	// Initialize form state
	handleExtractionTypeChange();

	// Check registration status and load cached data when popup opens
	checkRegistrationAndLoadData();

	initializeJsonViewer();

	// MARK: Load API Endpoint Preference
	async function loadApiEndpointPreference() {
		console.log("[POPUP] Loading API enpdoint reference...");

		try {
			// load saved custom endpoints first
			await loadSavedCustomEndpoints();

			const result = await browser.storage.local.get([
				"apiConnections",
				"activeApiEndpoint",
				"customEndpointUrl",
			]);

			// Load custom URL if saved
			if (result.customEndpointUrl) {
				customEndpointUrl = result.customEndpointUrl;
				customEndpointInput.value = customEndpointUrl;
			}

			// Check if active endpoint is a custom URL
			const activeEndpoint = result.activeApiEndpoint;
			const defaultEndpoints = [
				"http://localhost:3000",
				"https://calyx.williambjensen.com",
			];
			const isDefaultEndpoint = defaultEndpoints.includes(activeEndpoint);
			const isSavedCustomEndpoint =
				savedCustomEndpoints.includes(activeEndpoint);

			if (
				activeEndpoint &&
				!isDefaultEndpoint &&
				!isSavedCustomEndpoint
			) {
				// Active endpoint is a new custom URL
				apiEndpointSelect.value = "custom";
				customEndpointUrl = activeEndpoint;
				customEndpointInput.value = activeEndpoint;
				selectedApiEndpoint = activeEndpoint;
				document.getElementById(
					"customEndpointContainer"
				).style.display = "block";
			} else if (activeEndpoint) {
				// Use active endpoint (default or saved custom)
				selectedApiEndpoint = activeEndpoint;
				apiEndpointSelect.value = activeEndpoint;
				document.getElementById(
					"customEndpointContainer"
				).style.display = "none";
			} else {
				// No active endpoint, default to production
				selectedApiEndpoint = "https://calyx.williambjensen.com";
				apiEndpointSelect.value = selectedApiEndpoint;
				document.getElementById(
					"customEndpointContainer"
				).style.display = "none";
			}

			console.log("[POPUP] Loaded active endpoint:", selectedApiEndpoint);
			console.log(
				"[POPUP] Available connections:",
				Object.keys(result.apiConnections || {})
			);

			// Update the indicator
			if (activeEndpoint) {
				const activeConnection =
					result.apiConnections?.[activeEndpoint];
				const isConnected =
					activeConnection &&
					activeConnection.token &&
					!activeConnection.registrationError;
				updateActiveEndpointIndicator(activeEndpoint, isConnected);
			} else {
				updateActiveEndpointIndicator(null);
			}

			updateConnectionStatus();
		} catch (error) {
			console.error(
				"[POPUP] Error loading API endpoint preference:",
				error
			);

			updateActiveEndpointIndicator(null);
			updateConnectionStatus();
		}
	}

	// MARK: Handle Endpoint Change
	function handleEndpointChange() {
		const selectValue = apiEndpointSelect.value;
		console.log("[POPUP] Endpoint changed to:", selectValue);

		// Show/hide custom input
		const customContainer = document.getElementById(
			"customEndpointContainer"
		);
		if (selectValue === "custom") {
			customContainer.style.display = "block";

			// Use the custom URL if available
			selectedApiEndpoint = customEndpointUrl || "";

			// Disable connect until valid URL entered
			console.log(
				"[POPUP] Custom URL:",
				selectedApiEndpoint,
				"isValid?",
				isValidUrl(selectedApiEndpoint)
			);
			connectBtn.disabled = !isValidUrl(selectedApiEndpoint);
			connectBtn.textContent = "Connect";
		} else {
			customContainer.style.display = "none";
			selectedApiEndpoint = selectValue;

			connectBtn.disabled = false;
			connectBtn.textContent = "Connect";
		}

		// Update connection status - don't auto-connect, let users click Connect
		updateConnectionStatus();
	}

	// MARK: Custom Endpoint
	function handleCustomEndpointInput() {
		customEndpointUrl = customEndpointInput.value.trim();

		// Update the selected endpoint to use the custom URL
		if (apiEndpointSelect.value === "custom") {
			selectedApiEndpoint = customEndpointUrl;

			// Save to storage
			browser.storage.local.set({ customEndpointUrl: customEndpointUrl });

			// Enable/disable connect button based on valid URL
			connectBtn.disabled = !isValidUrl(customEndpointUrl);
		}
	}

	function isValidUrl(string) {
		try {
			const url = new URL(string);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch (_) {
			return false;
		}
	}

	// MARK: Load Saved Custom Endpoints
	async function loadSavedCustomEndpoints() {
		try {
			const result = await browser.storage.local.get([
				"savedCustomEndpoints",
			]);
			savedCustomEndpoints = result.savedCustomEndpoints || [];
			console.log(
				"[POPUP] Loaded saved custom endpoints:",
				savedCustomEndpoints
			);
			rebuildEndpointSelectOptions();
		} catch (error) {
			console.error(
				"[POPUP] Error loading saved custom endpoints:",
				error
			);
		}
	}

	// MARK: Rebuild Endpoint Select Options
	function rebuildEndpointSelectOptions() {
		const currentValue = apiEndpointSelect.value;
		apiEndpointSelect.innerHTML = "";

		// Default endpoints at top
		const defaultEndpoints = [
			{
				value: "http://localhost:3000",
				label: "Local Development (localhost:3000)",
			},
			{
				value: "https://calyx.williambjensen.com",
				label: "Production (calyx.williambjensen.com)",
			},
		];

		defaultEndpoints.forEach((ep) => {
			const option = document.createElement("option");
			option.value = ep.value;
			option.textContent = ep.label;
			apiEndpointSelect.appendChild(option);
		});

		// Saved custom endpoints in middle
		if (savedCustomEndpoints.length > 0) {
			savedCustomEndpoints.forEach((customUrl) => {
				const option = document.createElement("option");
				option.value = customUrl;
				option.textContent = customUrl;
				apiEndpointSelect.appendChild(option);
			});
		}

		// "Custom URL..." option at bottom
		const customOption = document.createElement("option");
		customOption.value = "custom";
		customOption.textContent = "Custom URL...";
		apiEndpointSelect.appendChild(customOption);

		// Restore previous selection if it still exists
		const optionExists = Array.from(apiEndpointSelect.options).some(
			(opt) => opt.value === selectedApiEndpoint
		);
		if (optionExists) {
			apiEndpointSelect.value = currentValue;
		}
	}

	// MARK: Save Custom Endpoint
	async function saveCustomEndpoint(url) {
		try {
			// Don't save if it's a default endpoint
			const defaultEndpoints = [
				"http://localhost:3000",
				"https://calyx.williambjensen.com",
			];

			// don't save if it's default or already saved
			if (
				defaultEndpoints.includes(url) ||
				savedCustomEndpoints.includes(url)
			) {
				return;
			}

			savedCustomEndpoints.push(url);

			await browser.storage.local.set({
				savedCustomEndpoints: savedCustomEndpoints,
			});

			console.log("[POPUP] Saved custom endpoint", url);

			rebuildEndpointSelectOptions();

			// Select the newly saved endpoint
			apiEndpointSelect.value = url;
			selectedApiEndpoint = url;

			// Hide custom input since we now have it as an option
			document.getElementById("customEndpointContainer").style.display =
				"none";
		} catch (error) {
			console.error("[POPUP] Error saving custom endpoint:", error);
		}
	}

	// MARK: Request Permission
	async function requestPermissionForCustomURL(url) {
		try {
			const urlObj = new URL(url);
			const origin = `${urlObj.protocol}//${urlObj.host}/*`;

			console.log("[POPUP] Checking permission for:", origin);

			// Check if we already have permission
			const hasPermission = await browser.permissions.contains({
				origins: [origin],
			});

			if (hasPermission) {
				console.log("[POPUP] Permission already granted");
				return true;
			}

			console.log("[POPUP] Requesting permission for custom endpoint...");

			// Request permission
			const granted = await browser.permissions.request({
				origins: [origin],
			});

			if (!granted) {
				throw new Error("Permission denied for custom url");
			}

			console.log("[POPUP] Permission granted");
			return true;
		} catch (error) {
			console.error("[POPUP] Error requesting permission:", error);
			throw error;
		}
	}

	// MARK: Handle Connect
	async function handleConnect(endpointToConnect = null) {
		if (isConnecting) return;

		// Use provided endpoint or fall back to selected endpoint
		const targetEndpoint =
			!endpointToConnect || endpointToConnect instanceof PointerEvent
				? selectedApiEndpoint
				: endpointToConnect;
		console.log("[POPUP] Connecting  to:", targetEndpoint);

		// Check if this is a custom endpoint and request permission
		const defaultEndpoints = [
			"http://localhost:3000",
			"https://calyx.williambjensen.com",
		];
		const isCustomEndpoint = !defaultEndpoints.includes(targetEndpoint);

		if (isCustomEndpoint) {
			try {
				showStatus("Requesting permission for custom url...", "info");
				await requestPermissionForCustomURL(targetEndpoint);
			} catch (error) {
				showStatus(`Permission required: ${error.message}`, "error");
				return { success: false, error: error.message };
			}
		}

		isConnecting = true;
		connectBtn.disabled = true;
		connectBtn.textContent = "Connecting...";
		refreshBtn.disabled = true;

		showStatus(`Connecting to ${targetEndpoint}...`, "info");

		try {
			// Request connection to selected endpoint (will reuse existing token if valid)
			const response = await new Promise((resolve) => {
				browser.runtime.sendMessage(
					{
						action: "connectToEndpoint",
						endpoint: targetEndpoint,
					},
					(response) => resolve(response)
				);
			});

			if (response && response.success) {
				showStatus(`Connected to ${selectedApiEndpoint}!`, "success");
				connectBtn.textContent = "Connected";
				connectBtn.disabled = true;

				// Update the active endpoint indicator
				updateActiveEndpointIndicator(targetEndpoint, true);

				// Save custom endpoint if it was a custom url
				if (apiEndpointSelect.value === "custom") {
					await saveCustomEndpoint(targetEndpoint);
				}

				// Update the API functionality
				postApiBtn.disabled = false;
				if (postApiBtn.textContent === "API Unavailable") {
					postApiBtn.textContent = "Send to API";
				}

				return { success: true, endpoint: targetEndpoint };
			} else {
				throw new Error(response?.error || "Connection failed");
			}
		} catch (error) {
			console.error("[POPUP] Connection failed:", error);
			showStatus(`Failed to connect:  ${error.message}`, "error");
			connectBtn.textContent = "Connect";
			connectBtn.disabled = false;

			return { sucess: false, error: error.message };
		} finally {
			isConnecting = false;
			refreshBtn.disabled = false;
			updateConnectionStatus();
		}
	}

	// MARK: Refresh Connection
	async function refreshConnection() {
		console.log("[POPUP] Refreshing connection...");

		refreshBtn.disabled = true;
		refreshBtn.textContent = "Refreshing...";
		connectBtn.disabled = true;

		showStatus("Clearing connection data...", "info");

		try {
			await deleteConnection(selectedApiEndpoint);

			showStatus("Re-connecting to endpoint...", "info");

			const result = await handleConnect(selectedApiEndpoint);

			if (result?.success) {
				showStatus(
					`Successfully refreshed connection to ${selectedApiEndpoint}!`,
					"success"
				);
			} else {
				throw new Error(response?.error || "Re-connection failed");
			}
		} catch (error) {
			console.log("[POPUP] Error during refresh:", error);
			showStatus(`Refresh failed: ${error.message}`, "error");
			connectBtn.disabled = false;
			connectBtn.textContent = "Connect";
		}

		refreshBtn.disabled = false;
		refreshBtn.textContent = "Refresh";
		updateConnectionStatus();
	}

	// MARK: Delete Connection
	async function deleteConnection(apiBase) {
		console.log("[POPUP] Deleting connection for:", apiBase);
		if (!apiBase) return;

		const storage = await browser.storage.local.get([
			"apiConnections",
			"activeApiEndpoint",
		]);
		const apiConnections = storage.apiConnections || {};

		const token = apiConnections[apiBase]?.token;
		console.log("[POPUP] Using token:", token);
		if (!token) {
			console.log("[POPUP] No token found for endpoint:", apiBase);
			return;
		}

		const response = await fetch(
			`${apiBase}/api/crispnow/extension/register`,
			{
				method: "DELETE",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiConnections[apiBase].token}`,
				},
			}
		);

		if (!response.ok && response.status !== 401) {
			const errorText = await response.text();

			console.warn(
				`Failed to delete connection: ${response.status} - ${errorText}`
			);

			// Store the error for this endpoint
			apiConnections[apiBase] = {
				...apiConnections[apiBase],
				unregistrationError: `${response.status} - ${errorText}`,
				lastUnregistrationAttempt: new Date().toISOString(),
			};
			throw new Error(
				`Failed to delete connection: ${response.status} - ${errorText}`
			);
		}

		delete apiConnections[apiBase];

		const changes = {
			apiConnections,
			activeApiEndpoint: storage.activeApiEndpoint,
		};

		// If this was the active endpoint, we need to clear that too
		if (storage.activeApiEndpoint === selectedApiEndpoint) {
			// await browser.storage.local.set({
			// 	activeApiEndpoint: null,
			// 	apiConnections,
			// });
			changes.activeApiEndpoint = null;

			updateActiveEndpointIndicator(null);

			// Disable API functionality until reconnected
			postApiBtn.disabled = true;
			postApiBtn.textContent = "API Unavailable";
		}

		await browser.storage.local.set(changes);

		console.log("[POPUP] Connection deleted successfully");
	}

	// MARK: Update Connection Status
	async function updateConnectionStatus() {
		try {
			// Special handling for custom endpoints
			if (apiEndpointSelect.value === "custom") {
				if (!isValidUrl(selectedApiEndpoint)) {
					connectBtn.textContent = "Connect";
					connectBtn.disabled = true; // Disabled until valid URL
					return;
				}
			}

			const storage = await browser.storage.local.get([
				"apiConnections",
				"activeApiEndpoint",
			]);
			const apiConnections = storage.apiConnections || {};
			const activeEndpoint = storage.activeApiEndpoint;
			const selectedConnection = apiConnections[selectedApiEndpoint];

			console.log("[POPUP] Connection status check:", {
				selectedApiEndpoint,
				activeEndpoint,
				hasConnectionForSelected: !!selectedConnection,
				selectedConnectionValid:
					selectedConnection &&
					selectedConnection.token &&
					!selectedConnection.registrationError,
			});

			// Check if we have a valid connection for the selected endpoint
			if (
				selectedConnection &&
				selectedConnection.token &&
				!selectedConnection.registrationError
			) {
				const isExpired = selectedConnection.tokenExpiresAt
					? new Date(selectedConnection.tokenExpiresAt) <= new Date()
					: false;

				if (isExpired) {
					connectBtn.textContent = "Reconnect (Expired)";
					connectBtn.disabled = false;
				} else if (activeEndpoint === selectedApiEndpoint) {
					connectBtn.textContent = "Connected";
					connectBtn.disabled = true;
				} else {
					connectBtn.textContent = "Switch to this endpoint";
					connectBtn.disabled = false;
				}
			} else if (
				selectedConnection &&
				selectedConnection.registrationError
			) {
				connectBtn.textContent = "Retry Connection";
				connectBtn.disabled = false;
			} else {
				connectBtn.textContent = "Connect";
				connectBtn.disabled = false;
			}
		} catch (error) {
			console.error("[POPUP] Error checking connection status:", error);
			connectBtn.textContent = "Connect";
			connectBtn.disabled = false;
		}
	}

	function handleExtractionTypeChange() {
		const selectedType = extractionType.value;
		const isScheduleType =
			selectedType === "schedule" || selectedType === "store-schedule";

		if (isScheduleType) {
			weeksContainer.classList.remove("disabled");
			weeksInput.disabled = false;
		} else {
			weeksContainer.classList.add("disabled");
			weeksInput.disabled = true;
		}

		updateExtractButtonText();
	}

	function updateExtractButtonText() {
		const selectedType = extractionType.value;
		const weeks = parseInt(weeksInput.value) || 3;

		switch (selectedType) {
			case "schedule":
				extractBtn.textContent = `Extract All Stores (${weeks} weeks)`;
				break;
			case "store-schedule":
				extractBtn.textContent = `Extract ${
					extractedSelf.store.name || "Current Store"
				} (${weeks} weeks)`;
				break;
			case "users":
				extractBtn.textContent = `Extract User Profiles`;
				break;
			case "self":
				extractBtn.textContent = `Extract My Profile`;
				break;
			default:
				extractBtn.textContent = `Extract Data from Page`;
		}
	}

	function handleExtraction() {
		const selectedType = extractionType.value;
		const weeks = parseInt(weeksInput.value) || 3;

		extractBtn.disabled = true;
		extractBtn.textContent = "Extractiong...";

		switch (selectedType) {
			case "schedule":
				extractSchedule(weeks);
				break;
			case "store-schedule":
				extractStoreSchedule(weeks);
				break;
			case "users":
				extractUsers();
				break;
			case "self":
				document.getElementById("userInfoDisplay").style.display =
					"none";
				extractSelf();
				break;
			default:
				showStatus("Please select an extraction type", "error");
				resetExtractButton();
		}
	}

	function resetExtractButton() {
		extractBtn.disabled = false;
		updateExtractButtonText();
	}

	// MARK: Update Endpoint Indicator
	function updateActiveEndpointIndicator(
		activeEndpoint,
		isConnected = false
	) {
		const indicator = document.getElementById("activeEndpointIndicator");
		const indicatorText = indicator.querySelector(".indicator-text");

		if (!activeEndpoint) {
			indicator.style.display = "none";
			return;
		}

		indicator.style.display = "flex";

		if (isConnected) {
			indicator.classList.remove("disconnected");
			indicatorText.textContent = `Active: ${activeEndpoint}`;
		} else {
			indicator.classList.add("disconnected");
			indicatorText.textContent = `Disconnected: ${activeEndpoint}`;
		}
	}

	// MARK: Check Registration and Load Data
	async function checkRegistrationAndLoadData() {
		console.log("[POPUP] Checking registration status...");

		await loadApiEndpointPreference();

		try {
			// Check registration status
			const registrationStatus = await new Promise((resolve) => {
				browser.runtime.sendMessage(
					{ action: "checkRegistration" },
					(response) => resolve(response)
				);
			});

			console.log("[POPUP] Registration status:", registrationStatus);

			if (!registrationStatus.registered) {
				// Check if we have any available connections for other endpoints
				if (registrationStatus?.availableConnections?.length > 0) {
					console.log(
						"[POPUP] No active endpoint, but connections available:",
						registrationStatus.availableConnections
					);
					showStatus(
						`No active endpoint selected. Available: ${registrationStatus.availableConnections.join(
							", "
						)}`,
						"info"
					);

					// Disable API functionality until user selects an endpoint
					postApiBtn.disabled = true;
					postApiBtn.textContent = "Select Endpoint First";
				} else if (registrationStatus.hasError) {
					console.log("[POPUP] Registration error detected");
					showStatus(
						"Connection issue detected, please refresh and connect again",
						"info"
					);

					postApiBtn.disabled = true;
					postApiBtn.textContent = "API Unavailable";
				} else {
					console.log("[POPUP] No registration found");
					showStatus(
						"Not connected. Click 'Connect' to start",
						"info"
					);
					postApiBtn.disabled = true;
					postApiBtn.textContent = "API Unavailable";
				}
			} else {
				console.log("[POPUP] Extension registered successfully");
				const registeredDate = new Date(
					registrationStatus.registeredAt
				);
				const activeEndpoint = registrationStatus.activeApiEndpoint;
				showStatus(
					`Connected to ${activeEndpoint} (${getTimeAgo(
						registeredDate
					)})`,
					"success"
				);

				// Enable API functionality
				postApiBtn.disabled = false;
				if (postApiBtn.textContent === "API Unavailable") {
					postApiBtn.textContent = "Send to API";
				}
			}
		} catch (error) {
			console.error("[POPUP] Error checking registration:", error);
			showStatus("Error checking connection status", "error");
		}

		// Load any cached data regardless of registration status
		await loadCachedData();

		// Update flow based on loaded data
		checkAndUpdateFlow();
	}

	// MARK: Get API Configuration
	async function getApiConfig() {
		return new Promise((resolve, reject) => {
			browser.runtime.sendMessage(
				{ action: "getApiToken" },
				(response) => {
					if (response.success) {
						resolve({
							token: response.token,
							endpoint: response.apiEndpoint,
						});
					} else {
						reject(
							new Error(
								response.error || "Failed to get API token"
							)
						);
					}
				}
			);
		});
	}

	// #region Flow Step

	function setFlowStep(step) {
		const body = document.body;

		// Remove all flow step classes
		body.classList.remove("flow-step-1", "flow-step-2", "flow-step-3");

		// Add the appropriate flow step class
		body.classList.add(`flow-step-${step}`);

		console.log(`[POPUP] Flow step set to ${step}`);
	}

	function checkAndUpdateFlow() {
		const hasSelfData = !!extractedSelf;
		const hasUserData = extractedUsers.length > 0;
		const hasScheduleData =
			extractedSchedule.length > 0 || Object.keys(apiData).length > 0;
		const hasCachedData = hasUserData || hasScheduleData; // don't want to include self data

		console.log("[POPUP] Flow check:", {
			hasSelfData,
			hasScheduleData,
			hasCachedData,
			extractedScheduleLength: extractedSchedule.length,
			apiDataKeys: Object.keys(apiData).length,
		});

		// Show clear cache button if there's any cached data
		if (hasCachedData) {
			clearCacheBtn.style.display = "inline-block";
		} else {
			clearCacheBtn.style.display = "none";
		}

		// Determine flow step
		if (!hasSelfData) {
			setFlowStep(1);
		} else if (!hasScheduleData) {
			// setFlowStep(2);
			transitionToStep2();
		} else {
			// setFlowStep(3);
			transitionToStep3();
		}
	}

	function transitionToStep2() {
		extractedSelf = extractedSelf; // Ensure we have self data
		setFlowStep(2);
		showStatus("Ready to extract schedule data!", "success");
	}

	function transitionToStep3() {
		setFlowStep(3);
	}
	// #endregion

	// MARK: Update Data Selector
	function updateDataSelector() {
		availableDataTypes = [];
		dataTypeSelect.innerHTML = "";

		console.log(
			"[POPUP] data:",
			"scheduleData:",
			extractedSchedule,
			"extractedUsers:",
			extractedUsers,
			"extractedSelf:",
			extractedSelf,
			"apiData:",
			apiData
		);

		// Check what data is available
		if (
			extractedSchedule.length > 0 ||
			icsContent ||
			(apiData && Object.keys(apiData).length > 0)
		) {
			availableDataTypes.push({
				value: "scheduleData",
				label: `Schedule Data (${extractedSchedule.length} shifts)`,
				apiPath: "/api/crispnow",
				// data: {apiData},
				// Keep detail API data but only send the necessary bits
				data: {
					metadata: {
						totalShifts: apiData.metadata.totalShifts,
						totalEmployees: apiData.metadata.totalEmployees,
						dateRange: apiData.metadata.dateRange,
						employees: apiData.metadata.employees,
						extractedAt: apiData.metadata.extractedAt,
					},
					employeeData: apiData.employeeData,
				},
			});
		}

		if (extractedUsers.length > 0) {
			availableDataTypes.push({
				value: "users",
				label: `User Profiles (${extractedUsers.length} users)`,
				apiPath: "/api/users",
				data: { users: extractedUsers },
			});
		}

		if (extractedSelf) {
			availableDataTypes.push({
				value: "self",
				label: `My Profile (${extractedSelf.fullName || "Self"})`,
				apiPath: "/api/users",
				data: {
					users: [
						// {
						// 	name: extractedSelf.fullName,
						// 	email: extractedSelf.email,
						// 	password: extractedSelf.pincode,
						// },
						extractedSelf,
					],
				},
			});
		}

		// Populate select options
		availableDataTypes.forEach((dataType) => {
			const option = document.createElement("option");
			option.value = dataType.value;
			option.textContent = dataType.label;
			dataTypeSelect.appendChild(option);
		});

		// Show/hide data selection based on availability
		if (availableDataTypes.length > 0) {
			dataSelection.style.display = "block";
		} else {
			dataSelection.style.display = "none";
		}
	}

	// MARK: Load Cached Data
	async function loadCachedData() {
		console.log("[POPUP] Loading cached data...");

		try {
			const result = await browser.storage.local.get([
				"scheduleData",
				"extractedAt",
				"selfUserData",
				"selfExtractedAt",
				"usersData",
			]);
			if (result.scheduleData) {
				console.log(
					"[POPUP] Found cached schedule data:",
					result.scheduleData
				);
				extractedSchedule = result.scheduleData.schedule.map(
					(shift) => ({
						...shift,
						date: new Date(shift.date),
					})
				);
				icsContent = result.scheduleData.icsContent;
				apiData = result.scheduleData.apiData;

				const extractedAt = new Date(result.extractedAt);
				const timeAgo = getTimeAgo(extractedAt);

				showStatus(
					`Loaded cached data (${timeAgo}) - ${extractedSchedule.length} shifts`,
					"success"
				);
				renderSchedulePreview();

				// Update convert button text to indicate cached data exists
				extractBtn.textContent = "Extract Fresh Data (5 Weeks)";
			} else {
				console.log("[POPUP] No cached data found");
			}

			// Load users data
			if (result.usersData) {
				console.log("[POPUP] Found cached users data");
				extractedUsers = result.usersData;
			} else {
				console.log("[POPUP] No cached users data found");
			}

			// Load self user d ata
			if (result.selfUserData) {
				console.log(
					"[POPUP] Found cached self user data:",
					result.selfUserData
				);
				extractedSelf = result.selfUserData;

				const selfExtractedAt = new Date(result.selfExtractedAt);
				const timeAgo = getTimeAgo(selfExtractedAt);

				// Update the self button to show cached status
				selfBtn.textContent = `Self User Cached (${timeAgo})`;
				renderUserInfo();

				console.log("[POPUP] Self user data loaded from cache");
			} else {
				console.log("[POPUP] No cached self user data found");
			}

			updateDataSelector();
			updateStoreOptionText();
		} catch (error) {
			console.error("[POPUP] Error loading cached data:", error);
		}
	}

	// MARK: Save Self User Data
	async function saveSelfUserData() {
		console.log(
			"[POPUP] Saving self user data to stroage...",
			extractedSelf
		);

		try {
			await browser.storage.local.set({
				selfUserData: extractedSelf,
				selfExtractedAt: new Date().toISOString(),
			});

			console.log("[POPUP] Self user data saved successfully");
		} catch (error) {
			console.error("[POPUP] Error saving self user data:", error);
		}
	}

	// MARK: Save User Profiles
	async function saveUsersData() {
		console.log("[POPUP] Saving users data to storage...");

		try {
			await browser.storage.local.set({
				usersData: extractedUsers,
				usersExtractedAt: new Date().toISOString(),
			});

			console.log("[POPUP] Users data saved successfully");
		} catch (error) {
			console.error("[POPUP] Error saving users data:", error);
		}
	}

	// MARK: Save Schedule Data
	async function saveScheduleData() {
		console.log(
			"[POPUP] Saving schedule data to storage...",
			extractedSchedule
		);

		try {
			const dataToSave = {
				schedule: extractedSchedule.map((shift) => {
					// Ensure date is a Date object before converting to ISO string
					let dateString;
					if (shift.date instanceof Date) {
						dateString = shift.date.toISOString();
					} else if (typeof shift.date === "string") {
						// Already a string, use as-is or try to parse and re-stringify for consistency
						try {
							dateString = new Date(shift.date).toISOString();
						} catch (e) {
							console.warn(
								"[POPUP] Invalid date string, using as-is:",
								shift.date
							);
							dateString = shift.date;
						}
					} else {
						console.warn(
							"[POPUP] Unknown date format, converting to string:",
							shift.date
						);
						dateString = String(shift.date);
					}
					return {
						...shift,
						date: dateString,
					};
				}),
				icsContent: icsContent,
				apiData: apiData,
			};

			await browser.storage.local.set({
				scheduleData: dataToSave,
				extractedAt: new Date().toISOString(),
			});

			console.log("[POPUP] Schedule data saved successfully");
		} catch (error) {
			console.error("[POPUP] Error saving schedule data:", error);
		}
	}

	// MARK: Clear Cached Data
	async function clearCachedData() {
		console.log("[POPUP] Clearing cached data...");

		try {
			await browser.storage.local.remove([
				"scheduleData",
				"extractedAt",
				// "selfUserData",
				// "selfExtractedAt",
			]);

			extractedSchedule = [];
			icsContent = "";
			apiData = {};
			// extractedSelf = null;

			schedulePreview.innerHTML = "";
			// clearCacheBtn.style.display = "none";

			updateExtractButtonText();
			updateDataSelector();
			// extractBtn.textContent = "Extract All Stores × 5 Weeks";
			// selfBtn.textContent = "Extract Self User from Page";

			// Hide user info display
			// document.getElementById("userInfoDisplay").style.display = "none";

			showStatus("Cached data cleared", "success");
			console.log("[POPUP] Cached data cleared successfully");

			// Reset to step 1 after clearing data
			checkAndUpdateFlow();
		} catch (error) {
			console.error("[POPUP] Error clearing cached data:", error);
			showStatus("Error clearing cached data", "error");
		}
	}

	// MARK: Get Time Ago
	function getTimeAgo(date) {
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);

		if (diffMins < 1) return "just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		return `${Math.floor(diffHours / 24)}d ago`;
	}

	// MARK: Show Status
	function showStatus(message, type = "success") {
		status.textContent = message;
		status.className = `status ${type}`;
		status.style.display = "block";

		// if (type === "success") {
		// 	setTimeout(() => {
		// 		status.style.display = "none";
		// 	}, 3000);
		// }
	}

	// MARK: Extract Self
	function extractSelf() {
		selfBtn.disabled = true;
		selfBtn.textContent = "Extracting...";

		browser.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				browser.tabs.sendMessage(
					tabs[0].id,
					{ action: "extractSelf" },
					function (response) {
						resetExtractButton();

						if (response && response.success) {
							if (response.needsStoreSelection) {
								// Show store selection UI
								renderProfileStoreSelection(response.stores);
							} else if (response.user) {
								extractedSelf = response.user;
								saveSelfUserData();
								renderUserInfo();
								transitionToStep2();
								showStatus(
									"Self user extracted successfully!",
									"success"
								);
							}
							updateDataSelector();
						} else {
							showStatus(
								response
									? response.error
									: "Failed to extract self user",
								"error"
							);
						}
					}
				);
			}
		);
	}

	// MARK: Extract Users
	function extractUsers() {
		browser.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				browser.tabs.sendMessage(
					tabs[0].id,
					{ action: "extractUsers" },
					function (response) {
						resetExtractButton();

						if (response && response.success) {
							// extractedUsers = response.users;
							extractedUsers = [
								...response.users,
								{
									email: extractedSelf.email,
									extractedAt: extractedSelf.extractedAt,
									firstName: extractedSelf.firstName,
									lastName: extractedSelf.lastName,
									fullName: extractedSelf.fullName,
									phone: extractedSelf.phone,
									store: extractedSelf.store.name, // change store to its name
									pincode: extractedSelf.pincode,
								},
							];
							console.log(
								"[POPUP] Extracted users:",
								extractedUsers
							);

							if (extractedUsers.length > 0) {
								showStatus(
									`Found ${extractedUsers.length} users!`
								);
								saveUsersData();
							} else {
								showStatus(
									"No users found on this page.",
									"error"
								);
							}
							updateDataSelector();
						} else {
							showStatus(
								response
									? response.error
									: "Failed to extract schedule from page.",
								"error"
							);
						}
					}
				);
			}
		);
	}

	// MARK: Extract Store Schedule
	function extractStoreSchedule() {
		browser.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				browser.tabs.sendMessage(
					tabs[0].id,
					{ action: "extractStoreSchedule" },
					function (response) {
						resetExtractButton();

						if (response && response.success) {
							console.log(
								"[POPUP] Store schedule extracted successfully",
								response
							);
							extractedSchedule = response.schedule;
							icsContent = response.icsContent;
							apiData = response.apiData;

							if (extractedSchedule.length > 0) {
								showStatus(
									`Found ${extractedSchedule.length} scheduled shifts!`
								);
								renderSchedulePreview();
								transitionToStep3();
								saveScheduleData();
							} else {
								showStatus(
									"No scheduled shifts found on this page.",
									"error"
								);
							}
							updateDataSelector();
						} else {
							showStatus(
								response
									? response.error
									: "Failed to extract schedule from page.",
								"error"
							);
						}
					}
				);
			}
		);
	}

	// MARK: Extract Schedule
	function extractSchedule(weeks) {
		browser.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				browser.tabs.sendMessage(
					tabs[0].id,
					{ action: "extractSchedule", weeks: weeks },
					function (response) {
						resetExtractButton();

						if (response && response.success) {
							console.log(
								"[POPUP] Schedule extracted successfully",
								response
							);
							extractedSchedule = response.schedule;
							icsContent = response.icsContent;
							apiData = response.apiData;

							if (extractedSchedule.length > 0) {
								showStatus(
									`Found ${extractedSchedule.length} scheduled shifts!`
								);
								renderSchedulePreview();
								transitionToStep3();
								saveScheduleData();
							} else {
								showStatus(
									"No scheduled shifts found on this page.",
									"error"
								);
							}
							updateDataSelector();
						} else {
							showStatus(
								response
									? response.error
									: "Failed to extract schedule from page.",
								"error"
							);
						}
					}
				);
			}
		);
	}

	// MARK: Update Store Text
	function updateStoreOptionText() {
		if (extractedSelf && extractedSelf.store && extractedSelf.store.name) {
			const storeOption = document.querySelector(
				"#extractionType option[value='store-schedule']"
			);
			if (storeOption) {
				storeOption.textContent = `${extractedSelf.store.name} Schedule`;
			}
		}
	}

	function renderUserInfo() {
		if (!extractedSelf) {
			document.getElementById("userInfoDisplay").style.display = "none";
			return;
		}

		console.log("[POPUP] Rendering user info:", extractedSelf);

		document.getElementById("userName").textContent =
			extractedSelf.fullName;
		document.getElementById("userEmail").textContent = extractedSelf.email;
		document.getElementById("userPhone").textContent = extractedSelf.phone;
		document.getElementById("userStore").textContent =
			extractedSelf.store.name;

		document.getElementById("userInfoDisplay").style.display = "block";
	}

	// MARK: Render Profile Store Selection
	function renderProfileStoreSelection(stores) {
		console.log("[POPUP] Rendering profile store selection:", stores);

		const storeSelection = document.getElementById(
			"userProfileStoreSelection"
		);
		const storeOptions = document.getElementById("userProfileStoreOptions");

		// Clear preivous options
		storeOptions.innerHTML = "";

		// Create button for each stores
		stores.forEach((store) => {
			const btn = document.createElement("button");
			btn.textContent = store.name;
			btn.classList.add("store-option");

			btn.addEventListener("click", () => {
				selectProfileStore(store.name, store.id);
			});

			storeOptions.appendChild(btn);
		});

		storeSelection.style.display = "block";

		showStatus(
			`Please select your store from ${stores.length} options.`,
			"info"
		);
	}

	// MARK: Select Profile Store
	function selectProfileStore(storeName, storeId) {
		console.log("[POPUP] Store selected:", storeName, storeId);

		const storeSelection = document.getElementById(
			"userProfileStoreSelection"
		);
		storeSelection.style.display = "none";

		showStatus(`Completing self extraction...`, "info");

		// Complete the extraction with selected store
		browser.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				browser.tabs.sendMessage(
					tabs[0].id,
					{
						action: "extractSelfWithStore",
						storeId: storeId,
						storeName: storeName,
					},
					function (response) {
						if (response && response.success && response.user) {
							extractedSelf = response.user;

							// Save to storage
							saveSelfUserData();

							renderUserInfo();

							// Update button text to show it's cached
							const now = new Date();
							selfBtn.textContent = `Self User Cached (${getTimeAgo(
								now
							)})`;

							console.log(
								"[POPUP] Self user data:",
								extractedSelf
							);
							transitionToStep2();
							showStatus(
								`Self user extracted successfully!`,
								"success"
							);
						} else {
							showStatus(
								response
									? response.error
									: "Failed to complete extraction",
								"error"
							);
						}
					}
				);
			}
		);
	}

	// MARK: Render Schedule Preview
	function renderSchedulePreview() {
		console.log(
			"[POPUP] Rendering schedule preview for",
			extractedSchedule.length,
			"items"
		);
		schedulePreview.innerHTML =
			'<h3 style="margin: 10px 0; font-size: 14px;">Found Schedule:</h3>';

		// Group shifts by week
		const shiftsByWeek = {};

		extractedSchedule.forEach((shift, index) => {
			try {
				// Ensure date is a Date object - this is the key fix
				let shiftDate;
				if (shift.date instanceof Date) {
					shiftDate = shift.date;
				} else if (typeof shift.date === "string") {
					shiftDate = new Date(shift.date);
				} else {
					console.error(
						`[POPUP] Invalid date format for shift ${index + 1}:`,
						shift.date
					);
					return; // Skip this shift
				}

				console.log(
					`[POPUP] Shift ${index + 1} date object:`,
					shiftDate
				);

				// Validate the date
				if (isNaN(shiftDate.getTime())) {
					console.error(
						`[POPUP] Invalid date for shift ${index + 1}:`,
						shift.date
					);
					return; // Skip this shift
				}

				// Get the start of the week (Sunday) for grouping
				const weekStart = new Date(shiftDate);
				weekStart.setDate(shiftDate.getDate() - shiftDate.getDay());
				const weekKey = weekStart.toDateString();

				if (!shiftsByWeek[weekKey]) {
					shiftsByWeek[weekKey] = [];
				}

				shiftsByWeek[weekKey].push({
					...shift,
					date: shiftDate, // Use the properly converted date
				});
			} catch (error) {
				console.error(
					`[POPUP] Error processing shift ${index + 1}:`,
					error,
					shift
				);
			}
		});

		// Render shifts grouped by week
		const sortedWeeks = Object.keys(shiftsByWeek).sort(
			(a, b) => new Date(a) - new Date(b)
		);

		sortedWeeks.forEach((weekKey, weekIndex) => {
			const weekStart = new Date(weekKey);
			const weekEnd = new Date(weekStart);
			weekEnd.setDate(weekStart.getDate() + 6);

			const weekHeader = document.createElement("div");
			weekHeader.style.cssText =
				"font-weight: bold; margin-top: 15px; margin-bottom: 5px; padding: 5px; background: #f0f0f0; border-radius: 3px; font-size: 12px;";
			weekHeader.textContent = `Week ${
				weekIndex + 1
			}: ${weekStart.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			})} - ${weekEnd.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			})}`;
			schedulePreview.appendChild(weekHeader);

			shiftsByWeek[weekKey]
				.sort((a, b) => a.date - b.date)
				.forEach((shift, shiftIndex) => {
					try {
						const div = document.createElement("div");
						div.className = "schedule-item";

						// Now we know shift.date is definitely a Date object
						const dayName = shift.date.toLocaleDateString("en-US", {
							weekday: "short",
						});
						const dateStr = shift.date.toLocaleDateString("en-US", {
							month: "short",
							day: "numeric",
						});

						console.log(
							`[POPUP] Week ${weekIndex + 1} Shift ${
								shiftIndex + 1
							} formatted - dayName: "${dayName}", dateStr: "${dateStr}"`
						);

						div.innerHTML = `
            <div class="day">${dayName} ${dateStr}</div>
            <div class="details">${shift.startTime} - ${shift.endTime}</div>
            <div class="details">${shift.employeeName} (${shift.role}) - ${shift.storeName}</div>
          `;

						schedulePreview.appendChild(div);
						console.log(
							`[POPUP] Week ${weekIndex + 1} Shift ${
								shiftIndex + 1
							} rendered successfully`
						);
					} catch (error) {
						console.error(
							`[POPUP] Error rendering shift:`,
							error,
							shift
						);

						// Create error display for this shift
						const errorDiv = document.createElement("div");
						errorDiv.className = "schedule-item";
						errorDiv.style.backgroundColor = "#ffe6e6";
						errorDiv.innerHTML = `
            <div class="day">Error rendering shift</div>
            <div class="details">${error.message}</div>
          `;
						schedulePreview.appendChild(errorDiv);
					}
				});
		});

		console.log("[POPUP] Schedule preview rendered successfully");
	}

	// MARK: Download ICS
	function downloadICS() {
		if (!icsContent) return;

		const blob = new Blob([icsContent], { type: "text/calendar" });
		const url = URL.createObjectURL(blob);

		browser.downloads.download(
			{
				url: url,
				filename: "work-schedule.ics",
			},
			function (downloadId) {
				if (downloadId) {
					showStatus("ICS file downloaded successfully!");
				} else {
					showStatus("Failed to download ICS file.", "error");
				}
				URL.revokeObjectURL(url);
			}
		);
	}

	// MARK: Copy API Data
	function copyApiData() {
		console.log("[POPUP] Copy API data button clicked");

		const selectedDataType = dataTypeSelect.value;
		const selectedData = availableDataTypes.find(
			(dt) => dt.value === selectedDataType
		);

		if (!selectedData) {
			console.error("[POPUP] No API data to copy");
			showStatus("No API data available to copy.", "error");
			return;
		}

		console.log("[POPUP] Copying data for:", selectedDataType);
		const jsonString = JSON.stringify(selectedData.data, null, 2);

		navigator.clipboard
			.writeText(jsonString)
			.then(() => {
				console.log("[POPUP] Data copied successfully");
				showStatus("Data copied to clipboard!");
			})
			.catch((err) => {
				console.error("[POPUP] Failed to copy data:", err);
				showStatus("Failed to copy data to clipboard.", "error");
			});
	}

	// Simple API helper
	// class ExtensionAPI {
	//   private token: string | null = null;

	//   async initialize() {
	//     const { apiToken } = await browser.storage.local.get("apiToken");
	//     this.token = apiToken;
	//   }

	//   async makeRequest(endpoint: string, options: RequestInit = {}) {
	//     if (!this.token) throw new Error("Extension not registered");

	//     return fetch(`${API_BASE}${endpoint}`, {
	//       ...options,
	//       headers: {
	//         Authorization: `Bearer ${this.token}`,
	//         "Content-Type": "application/json",
	//         ...options.headers,
	//       },
	//     });
	//   }
	// }

	// MARK: Post to API
	async function postToAPI() {
		console.log("[POPUP] Post to API button clicked");

		hideApiResponseViewer();

		const selectedDataType = dataTypeSelect.value;
		const selectedData = availableDataTypes.find(
			(dt) => dt.value === selectedDataType
		);

		if (!selectedData) {
			console.error("[POPUP] No data selected to send");
			showStatus("No data selected to send", "error");
			return;
		}

		if (!selectedData.apiPath) {
			showStatus(
				"No API endpoint configured for this data type",
				"error"
			);
			return;
		}

		postApiBtn.disabled = true;
		postApiBtn.textContent = "Sending...";
		let unsuccessful;

		try {
			// Get API configuration (token and endpoint)
			console.log("[POPUP] Getting API configuration...");
			const apiConfig = await getApiConfig();
			console.log("[POPUP] API config obtained:", {
				endpoint: apiConfig.endpoint,
				hasToken: !!apiConfig.token,
			});

			// Prepare request with authentication
			const requestOptions = {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiConfig.token}`,
				},
				body: JSON.stringify(selectedData.data),
			};

			const fullEndpoint = `${apiConfig.endpoint}${selectedData.apiPath}`;
			console.log(
				`[POPUP] Making authenticated request to: ${fullEndpoint}`
			);

			const response = await fetch(fullEndpoint, requestOptions);
			console.log(
				`[POPUP] Response from ${fullEndpoint}: `,
				response.status,
				response.statusText
			);

			if (response.ok) {
				const result = await response.json();
				console.log("[POPUP] API post successful:", result);

				// Check for rate limit headers
				const rateLimitRemaining = response.headers.get(
					"X-RateLimit-Remaining"
				);

				let successMessage = `Successfully sent ${selectedData.label} to API!`;
				if (rateLimitRemaining) {
					successMessage += ` (${rateLimitRemaining} requests remaining)`;
				}

				showStatus(successMessage);

				let summary = `✓ Successfully sent ${selectedData.label}`;
				displayApiResponse(result, true, summary);
			} else {
				console.warn(
					`[POPUP] API responsed with error ${response.status}: ${response.statusText}`
				);

				displayApiResponse(
					response,
					false,
					`✗ API Error ${response.status}`
				);

				// Handle specific error cases
				if (response.status === 401) {
					console.log(
						"[POPUP] 401 error - attempting automatic re-registration..."
					);
					showStatus(
						"Token expired. Please click 'Refresh' to reconnect.",
						"error"
					);
					unsuccessful = true;

					updateActiveEndpointIndicator(apiConfig.endpoint, false);
				} else if (response.status === 403) {
					showStatus(
						"Access denied. Check API permissions.",
						"error"
					);
					unsuccessful = true;
				} else if (response.status === 429) {
					const resetTime = response.headers.get("X-RateLimit-Reset");
					const retryAfter = response.headers.get("Retry-After");
					showStatus(
						`Rate limited. Try again ${
							retryAfter ? `in ${retryAfter} secionds` : "later"
						}.`,
						"error"
					);
				} else {
					const errorText = await response.text();
					showStatus(
						`API error ${response.status}: ${errorText}`,
						"error"
					);
				}
			}
		} catch (error) {
			console.error("[POPUP] Error posting to API:", error);

			displayApiResponse(
				{ error: error.message, timestamp: new Date().toISOString() },
				false,
				"✗ Connection Error"
			);

			if (
				error.message.includes("token") ||
				error.message.includes("registered")
			) {
				showStatus(`Connection error: ${error.message}`, "error");
			} else {
				showStatus(
					`Failed to connect to API: ${error.message}`,
					"error"
				);
			}
		}

		if (unsuccessful) {
			postApiBtn.disabled = true;
			postApiBtn.textContent = "API Unavailable";
		} else {
			postApiBtn.disabled = false;
			postApiBtn.textContent = "Send to API";
		}
	}
});

// MARK: Display API Response
function displayApiResponse(response, isSuccess = true, summary = null) {
	const viewer = document.getElementById("apiResponseViewer");
	const summaryElement = document.getElementById("responseSummary");
	const contentElement = document.getElementById("jsonResponseText");
	const headerElement = document.getElementById("jsonViewerHeader");
	const copyBtn = document.getElementById("copyJsonResponse");

	// Clear previous state
	viewer.classList.remove("success", "error", "warning", "expanded");

	// Set success/error state
	if (isSuccess) {
		viewer.classList.add("success");
	} else {
		viewer.classList.add("error");
	}

	// Set summary text
	if (summary) {
		summaryElement.textContent = summary;
	} else if (isSuccess) {
		summaryElement.textContent = "API Response - Success";
	} else {
		summaryElement.textContent = "API Response - Error";
	}

	// Format and display JSON
	try {
		const formattedJson = JSON.stringify(response, null, 2);
		contentElement.textContent = formattedJson;

		// Store response for copying
		copyBtn.onclick = () => copyJsonToClipboard(formattedJson);
	} catch (error) {
		contentElement.textContent = "Invalid JSON response";
		copyBtn.onclick = null;
	}

	// Show the viewer
	viewer.style.display = "block";

	// Auto-expand on errors for immediate visibility
	if (!isSuccess) {
		viewer.classList.add("expanded");
	}
}

// MARK: Copy JSON to Clipboard
function copyJsonToClipboard(jsonString) {
	navigator.clipboard
		.writeText(jsonString)
		.then(() => {
			showStatus("JSON copied to clipboard!", "success");
		})
		.catch((err) => {
			console.error("Failed to copy JSON:", err);
			showStatus("Failed to copy JSON", "error");
		});
}

// MARK: Initialize JSON Viewer
function initializeJsonViewer() {
	const header = document.getElementById("jsonViewerHeader");
	const viewer = document.getElementById("apiResponseViewer");

	header.addEventListener("click", (e) => {
		// Don't toggle if clicking on the copy button
		if (e.target.id === "copyJsonResponse") return;

		viewer.classList.toggle("expanded");
	});
}

// MARK: Hide API Response Viewer
function hideApiResponseViewer() {
	const viewer = document.getElementById("apiResponseViewer");
	viewer.style.display = "none";
	viewer.classList.remove("expanded", "success", "error", "warning");
}
