// service-worker.js
console.log("[SERVICE-WORKER] Service worker loaded");

const API_ENDPOINTS = [
	"http://localhost:3000",
	"http://10.0.0.188:3000",
	"https://calyx.williambjensen.com",
];

// Register extension when installed or updated
chrome.runtime.onInstalled.addListener(async (details) => {
	console.log("[SERVICE-WORKER] Extension installed/updated:", details);

	if (details.reason === "install") {
		console.log(
			"[SERVICE-WORKER] First install - registering extension..."
		);
		await registerExtension();
	} else if (details.reason === "update") {
		console.log("[SERVICE-WORKER] Extension updated - re-registering...");
		// await registerExtension();
	}
});

// Register extension when browser starts (if already installed)
chrome.runtime.onStartup.addListener(async () => {
	console.log("[SERVICE-WORKER] Browser startup - checking registration...");

	// Check if we have a valid token
	const { apiConnections, activeApiEndpoint } =
		await chrome.storage.local.get(["apiConnections", "activeApiEndpoint"]);

	const activeConnection = activeApiEndpoint
		? apiConnections?.[activeApiEndpoint]
		: null;

	if (activeConnection?.token) {
		console.log("[SERVICE-WORKER] Token found on startup, extension ready");
	} else {
		console.log(
			"[SERVICE-WORKER] No valid connection found. User needs to connect manually."
		);
	}
});

// Register extension with the server
async function registerExtension() {
	console.log("[SERVICE-WORKER] Starting extension registration...");

	try {
		const manifest = chrome.runtime.getManifest();
		const extensionId = chrome.runtime.id;

		// Get current storage to preserve existing connections
		const storage = await chrome.storage.local.get([
			"apiConnections",
			"activeApiEndpoint",
		]);
		const apiConnections = storage.apiConnections || {};

		console.log(`[SERVICE-WORKER] Registering extension ${extensionId}...`);

		// Try each API endpoint until one works
		let registrationSuccessful = false;
		let lastError = null;

		for (const apiBase of API_ENDPOINTS) {
			try {
				// Check if we already have a valid token for this endpoint
				const existingConnection = apiConnections[apiBase];
				if (
					existingConnection &&
					existingConnection.token &&
					!isTokenExpired(existingConnection)
				) {
					console.log(
						`[SERVICE-WORKER] Using existing valid token for ${apiBase}`
					);
					connectedEndpoint = apiBase;
					registrationSuccessful = true;
					break;
				}

				console.log(
					`[SERVICE-WORKER] Trying registration with ${apiBase}...`
				);

				const response = await fetch(
					`${apiBase}/api/crispnow/extension/register`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-Extension-ID": extensionId,
							"X-Extension-Version": manifest.version,
						},
					}
				);

				console.log(
					`[SERVICE-WORKER] Registration response from ${apiBase}:`,
					response.status,
					response.statusText
				);

				if (!response.ok) {
					const errorText = await response.text();
					// Store the error for this endpoint
					apiConnections[apiBase] = {
						...apiConnections[apiBase],
						registrationError: `${response.status} - ${errorText}`,
						lastAttempt: new Date().toISOString(),
					};
					throw new Error(
						`Registration failed: ${response.status} - ${errorText}`
					);
				}

				const data = await response.json();
				console.log("[SERVICE-WORKER] Registration successful:", data);

				// Store the token and clear any previous errors
				apiConnections[apiBase] = {
					token: data.token,
					tokenScopes: data.scopes || ["events:read", "events:write"],
					tokenExpiresAt: data.expires_at,
					registeredAt: new Date().toISOString(),
					registrationError: null,
				};

				connectedEndpoint = apiBase;
				registrationSuccessful = true;
				break;
			} catch (error) {
				console.warn(
					`[SERVICE-WORKER] Registration failed with ${apiBase}:`,
					error.message
				);
				lastError = error;
				continue; // Try next API enpoint
			}
		}

		if (!registrationSuccessful) {
			throw lastError || new Error("All registration endpoints failed");
		}

		// Save all connection data and set active endpoint
		await chrome.storage.local.set({
			apiConnections: apiConnections,
			activeApiEndpoint: storage.activeApiEndpoint || connectedEndpoint,
		});

		console.log(
			"[SERVICE-WORKER] Registration completed, active endpoint:",
			storage.activeApiEndpoint || connectedEndpoint
		);

		// Show success notification
		try {
			await chrome.notifications.create({
				type: "basic",
				iconUrl: "icon48.png",
				title: "Calyx Connected",
				message: "Schedule unfolder is now connected and ready to use!",
			});
		} catch (notificationError) {
			console.warn(
				"[SERVICE-WORKER] Could not show notification:",
				notificationError
			);
		}
	} catch (error) {
		console.error(
			"[SERVICE-WORKER] Registration completely failed:",
			error
		);

		// Show error notification
		try {
			await chrome.notifications.create({
				type: "basic",
				iconUrl: "icon48.png",
				title: "Extension Connection Failed",
				message:
					"Could not connect to server. API features may not work.",
			});
		} catch (notificationError) {
			console.warn(
				"[SERVICE-WORKER] Could not show error notification:",
				notificationError
			);
		}
	}
}

// Handle messages from popup or content scipts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	console.log("[SERVICE-WORKER] Message received:", message);

	if (message.action === "connectToEndpoint") {
		connectToSpecificEndpoint(message.endpoint)
			.then(() => sendResponse({ success: true }))
			.catch((error) =>
				sendResponse({ success: false, error: error.message })
			);

		return true;
	}

	if (message.action === "checkRegistration") {
		checkRegistrationStatus()
			.then((status) => sendResponse(status))
			.catch((error) =>
				sendResponse({ registered: false, error: error.message })
			);
		return true; // Async response
	}

	if (message.action === "retryRegistration") {
		registerExtension()
			.then(() => sendResponse({ success: true }))
			.catch((error) =>
				sendResponse({ success: false, error: error.message })
			);
		return true; // Async response
	}

	if (message.action === "getApiToken") {
		getValidApiToken()
			.then((result) => sendResponse(result))
			.catch((error) =>
				sendResponse({ success: false, error: error.message })
			);
		return true; // Async response
	}
});

async function connectToSpecificEndpoint(endpoint) {
	console.log(
		`[SERVICE-WORKER] Connecting to specific endpoint: ${endpoint}`
	);

	try {
		// Get existing connections
		const storage = await chrome.storage.local.get(["apiConnections"]);
		const apiConnections = storage.apiConnections || {};

		// Check if we already have a valid token for this endpoint
		const existingConnection = apiConnections[endpoint];
		if (
			existingConnection &&
			existingConnection.token &&
			!isTokenExpired(existingConnection)
		) {
			console.log(
				`[SERVICE-WORKER] Using existing valid token for ${endpoint}`
			);

			// Just set this as the active endpoint
			await chrome.storage.local.set({
				activeApiEndpoint: endpoint,
			});

			return;
		}

		// Need to register for this endpoint
		const manifest = chrome.runtime.getManifest();
		const extensionId = chrome.runtime.id;

		const response = await fetch(
			`${endpoint}/api/crispnow/extension/register`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Extension-ID": extensionId,
					"X-Extension-Version": manifest.version,
				},
			}
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Registration failed: ${response.status} - ${errorText}`
			);
		}

		const data = await response.json();
		console.log("[SERVICE-WORKER] Registration successful:", data);

		// Store the connection data for this specific endpoint
		apiConnections[endpoint] = {
			token: data.token,
			tokenScopes: data.scopes || [
				"events:read",
				"events:write",
				"users:write",
			],
			tokenExpiresAt: data.expires_at,
			registeredAt: new Date().toISOString(),
			registrationError: null,
		};

		// Save connections and set as active
		await chrome.storage.local.set({
			apiConnections: apiConnections,
			activeApiEndpoint: endpoint,
		});

		console.log(
			`[SERVICE-WORKER] Connected to specific endpoint successfully`
		);
	} catch (error) {
		console.error(
			`[SERVICE-WORKER] Failed to connect to specific endpoint:`,
			error
		);

		// Store the error for this endpoint
		const storage = await chrome.storage.local.get(["apiConnections"]);
		const apiConnections = storage.apiConnections || {};

		apiConnections[endpoint] = {
			...apiConnections[endpoint],
			registrationError: error.message,
			lastAttempt: new Date().toISOString(),
		};

		await chrome.storage.local.set({ apiConnections });

		throw error;
	}
}

// Check if a token is expired
function isTokenExpired(connection) {
	if (!connection.tokenExpiresAt) return false;

	const expiresAt = new Date(connection.tokenExpiresAt);
	return new Date() >= expiresAt;
}

// Check currenet registration status
async function checkRegistrationStatus() {
	const storage = await chrome.storage.local.get([
		"apiConnections",
		"activeApiEndpoint",
	]);

	console.log("[SERVICE-WORKER] Retrieved storage:", storage);

	const activeEndpoint = storage.activeApiEndpoint;
	const apiConnections = storage.apiConnections || {};
	const activeConnection = activeEndpoint
		? apiConnections[activeEndpoint]
		: null;

	if (!activeConnection) {
		return {
			registered: false,
			hasToken: false,
			hasError: false,
			isExpired: false,
			activeApiEndpoint: activeEndpoint,
			availableConnections: Object.keys(apiConnections),
		};
	}

	const hasToken = !!activeConnection.token;
	const hasError = !!activeConnection.registrationError;
	const isExpired = isTokenExpired(activeConnection);

	console.log(
		"[SERVICE-WORKER] registered:",
		hasToken,
		!hasError,
		!isExpired
	);

	return {
		registered: hasToken && !hasError && !isExpired,
		hasToken: hasToken,
		hasError: hasError,
		isExpired: isExpired,
		registeredAt: activeConnection.registeredAt,
		error: activeConnection.registrationError,
		activeApiEndpoint: activeEndpoint,
		availableConnections: Object.keys(apiConnections),
	};
}

// Get a valid API token for making requests
async function getValidApiToken() {
	const storage = await chrome.storage.local.get([
		"apiConnections",
		"activeApiEndpoint",
	]);

	const activeEndpoint = storage.activeApiEndpoint;
	const apiConnections = storage.apiConnections || {};
	const activeConnection = activeEndpoint
		? apiConnections[activeEndpoint]
		: null;

	if (!activeConnection) {
		throw new Error("No active API endpoint selected");
	}

	if (activeConnection.registrationError) {
		throw new Error(
			`Extension not registered with ${activeEndpoint}: ${activeConnection.registrationError}`
		);
	}

	if (!activeConnection.token) {
		throw new Error(
			`No api token found for ${activeEndpoint}. Extension may not be registered.`
		);
	}

	if (isTokenExpired(activeConnection)) {
		throw new Error(
			"API token expired. Please reconnect to this endpoint."
		);
	}

	return {
		success: true,
		token: activeConnection.token,
		apiEndpoint: activeEndpoint,
	};
}

// Periodic token check (check every hour) - DISABLED (manual connection required)
// chrome.alarms.create("checkToken", { periodInMinutes: 1440 });

// chrome.alarms.onAlarm.addListener(async (alarm) => {
// 	if (alarm.name === "checkToken") {
// 		console.log("[SERVICE-WORKER] Periodic token check...");

// 		const status = await checkRegistrationStatus();

// 		if (!status.registered) {
// 			console.log(
// 				"[SERVICE-WORKER] Token invalid, attempting re-registration..."
// 			);
// 			await registerExtension();
// 		} else {
// 			console.log("[SERVICE-WORKER] Token check passed");
// 		}
// 	}
// });
