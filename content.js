console.log("[CONTENT] Content script loaded on:", window.location.href);

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
	console.log("[CONTENT] Message received:", request);

	if (request.action === "extractStoreSchedule") {
		const weeks = request.weeks || 3;
		extractMultipleWeeks(weeks)
			.then((result) => {
				console.log(
					"[CONTENT] Multi-week extraction completed:",
					result
				);
				sendResponse(result);
			})
			.catch((error) => {
				console.error(
					"[CONTENT] Error during multi-week extraction:",
					error
				);
				sendResponse({ success: false, error: error.message });
			});

		return true;
	}

	if (request.action === "extractSchedule") {
		const weeks = request.weeks || 3;
		extractMultipleWeeksAllStores(weeks)
			.then((result) => {
				console.log(
					"[CONTENT] Multi-week extraction completed:",
					result
				);
				sendResponse(result);
			})
			.catch((error) => {
				console.error(
					"[CONTENT] Error during multi-week extraction:",
					error
				);
				sendResponse({ success: false, error: error.message });
			});

		// Return true to indicate async response
		return true;
	}

	if (request.action === "extractSelf") {
		console.log("[CONTENT] Starting self extraction...");
		extractSelfProfileStoreOptions()
			.then((result) => {
				console.log("[CONTENT] Self store options extracted:", result);
				sendResponse(result);
			})
			.catch((error) => {
				console.error("[CONTENT] Error during self extraction:", error);
				sendResponse({ success: false, error: error.message });
			});

		return true;
	}

	if (request.action === "extractSelfWithStore") {
		console.log(
			"[CONTENT] Completing self extraction with selected store:",
			request.storeId,
			request.storeName
		);

		completeSelfProfileExtraction(request.storeId, request.storeName)
			.then((result) => {
				console.log("[CONTENT] Self extraction completed:", result);
				sendResponse(result);
			})
			.catch((error) => {
				console.error(
					"[CONTENT] Error completing self extraction:",
					error
				);
				sendResponse({ success: false, error: error.message });
			});

		return true;
	}

	if (request.action === "extractUsers") {
		console.log("[CONTENT] Starting user extraction...");
		parseUserHTML()
			.then((result) => {
				console.log("[CONTENT] User extraction completed:", result);
				sendResponse(result);
			})
			.catch((error) => {
				console.error("[CONTENT] Error during user extraction:", error);
				sendResponse({ success: false, error: error.message });
			});

		// Return true to indicate async response
		return true;
	}
});

// MARK: Extract Multiple Weeks
async function extractMultipleWeeks(maxWeeks) {
	console.log("[CONTENT] Starting multi-store, multi-week extraction...");

	const scheduleElement = document.querySelector("#myaccount-schedule-tab");
	console.log("[CONTENT] Schedule element found:", !!scheduleElement);

	if (!scheduleElement) {
		console.error(
			"[CONTENT] Schedule container not found. Available IDs on page:"
		);
		const allIds = Array.from(document.querySelectorAll("[id]")).map(
			(el) => el.id
		);
		console.log("[CONTENT] Page IDs:", allIds);
		throw new Error("Schedule container not found on this page.");
	}

	const allSchedules = [];

	const { selfUserData } = await chrome.storage.local.get(["selfUserData"]);
	const store = selfUserData?.store;
	if (store) {
		console.log("[CONTENT] Found cached self user store:", store.name);
	} else {
		throw new Error("No self user found");
	}

	try {
		// Select the store and wait for it to load
		const storeSelected = await selectStoreAndWait(store);
		if (!storeSelected) {
			console.warn(`[CONTENT] Failed to select store ${store.name}`);
			throw new Error("Failed to select store");
		}

		for (let weekNum = 1; weekNum <= maxWeeks; weekNum++) {
			console.log(
				`[CONTENT] ===== Processing Week ${weekNum}/${maxWeeks} =====`
			);
			try {
				// Get current week info
				const currentWeekInfo = getCurrentWeekInfo();
				console.log(
					`[CONTENT] Week ${weekNum} info: ${currentWeekInfo}`
				);

				console.log(
					`[CONTENT] Successfully selected store: ${store.name}`
				);

				// Parse this store's schedule for current week
				const storeSchedule = parseScheduleHTML();
				console.log(
					`[CONTENT] Week ${weekNum} - Store ${store.name} parsed ${storeSchedule.length} shifts`
				);

				if (storeSchedule.length > 0) {
					// Add store and week metadata to each shift
					const storeScheduleWithMeta = storeSchedule.map(
						(shift) => ({
							...shift,
							weekInfo: currentWeekInfo,
							weekNumber: weekNum,
							storeId: store.id,
							storeName: store.name,
						})
					);

					allSchedules.push(...storeScheduleWithMeta);
					console.log(
						`[CONTENT] Week ${weekNum} - Store ${store.name} added ${storeSchedule.length} shifts. Total so far: ${allSchedules.length}`
					);
				} else {
					console.log(
						`[CONTENT] Week ${weekNum} - Store ${store.name} has no scheduled shifts`
					);
				}
			} catch (error) {
				console.error(
					`[CONTENT] Error processing week ${weekNum}:`,
					error
				);
				return;
				// Continue with next week instead of stopping entirely
				// if (weekNum < maxWeeks) {
				// 	try {
				// 		await clickNextWeekAndWait();
				// 	} catch (navError) {
				// 		console.error(
				// 			"[CONTENT] Navigation error, stopping extraction:",
				// 			navError
				// 		);
				// 		break;
				// 	}
				// }
			}
		}

		// Reset week position by backtracking
		for (let weekNum = maxWeeks; weekNum >= 1; weekNum--) {
			if (weekNum > 1) {
				console.log(
					`[CONTENT] Moving to previous week (${weekNum - 1})...`
				);
				const success = await clickPreviousWeekAndWait();

				if (!success) {
					console.warn(
						`[CONTENT] Failed to navigate to week ${
							weekNum - 1
						}, stopping extraction`
					);
					break;
				}

				console.log(
					`[CONTENT] Successfully navigated to week ${weekNum - 1}`
				);
			}
		}
	} catch (storeError) {
		console.error(
			`[CONTENT] Error processing store ${store.name}:`,
			storeError
		);
	}

	console.log("[CONTENT] Multi-store, multi-week extraction completed");
	console.log(
		"[CONTENT] Total shifts across all stores and weeks:",
		allSchedules.length
	);

	if (allSchedules.length === 0) {
		throw new Error(
			"No scheduled shifts found across any stores or weeks."
		);
	}

	// Generate both ICS and API-ready JSON
	const icsContent = generateICS(allSchedules);
	const apiData = generateAPIData(allSchedules);

	console.log(
		"[CONTENT] Generated ICS for all stores/weeks, content length:",
		icsContent.length
	);
	console.log("[CONTENT] Generated API data:", apiData);

	return {
		success: true,
		schedule: allSchedules,
		icsContent: icsContent,
		apiData: apiData,
		weeksProcessed: Math.min(
			maxWeeks,
			allSchedules.length > 0 ? maxWeeks : 1
		),
	};
}

// MARK: Extract Multiple Weeks
async function extractMultipleWeeksAllStores(maxWeeks) {
	console.log("[CONTENT] Starting multi-store, multi-week extraction...");

	const scheduleElement = document.querySelector("#myaccount-schedule-tab");
	console.log("[CONTENT] Schedule element found:", !!scheduleElement);

	if (!scheduleElement) {
		console.error(
			"[CONTENT] Schedule container not found. Available IDs on page:"
		);
		const allIds = Array.from(document.querySelectorAll("[id]")).map(
			(el) => el.id
		);
		console.log("[CONTENT] Page IDs:", allIds);
		throw new Error("Schedule container not found on this page.");
	}

	// Get list of available stores
	const stores = await getStoreList();
	console.log("[CONTENT] Available stores:", stores);

	if (stores.length === 0) {
		throw new Error("No stores found in dropdown.");
	}

	const allSchedules = [];

	for (let weekNum = 1; weekNum <= maxWeeks; weekNum++) {
		console.log(
			`[CONTENT] ===== Processing Week ${weekNum}/${maxWeeks} =====`
		);

		try {
			// Get current week info
			const currentWeekInfo = getCurrentWeekInfo();
			console.log(`[CONTENT] Week ${weekNum} info:`, currentWeekInfo);

			// Process each store for this week
			for (let storeIndex = 0; storeIndex < stores.length; storeIndex++) {
				const store = stores[storeIndex];
				console.log(
					`[CONTENT] Week ${weekNum} - Processing store ${
						storeIndex + 1
					}/${stores.length}: ${store.name}`
				);

				try {
					// Select the store and wait for it to load
					const storeSelected = await selectStoreAndWait(store);

					if (!storeSelected) {
						console.warn(
							`[CONTENT] Failed to select store ${store.name}, skipping...`
						);
						continue;
					}

					console.log(
						`[CONTENT] Successfully selected store: ${store.name}`
					);

					// Parse this store's schedule for current week
					const storeSchedule = parseScheduleHTML();
					console.log(
						`[CONTENT] Week ${weekNum} - Store ${store.name} parsed ${storeSchedule.length} shifts`
					);

					if (storeSchedule.length > 0) {
						// Add store and week metadata to each shift
						const storeScheduleWithMeta = storeSchedule.map(
							(shift) => ({
								...shift,
								weekInfo: currentWeekInfo,
								weekNumber: weekNum,
								storeId: store.id,
								storeName: store.name,
							})
						);

						allSchedules.push(...storeScheduleWithMeta);
						console.log(
							`[CONTENT] Week ${weekNum} - Store ${store.name} added ${storeSchedule.length} shifts. Total so far: ${allSchedules.length}`
						);
					} else {
						console.log(
							`[CONTENT] Week ${weekNum} - Store ${store.name} has no scheduled shifts`
						);
					}
				} catch (storeError) {
					console.error(
						`[CONTENT] Error processing store ${store.name}:`,
						storeError
					);
					// Continue with next store
				}
			}

			// After processing all stores for this week, move to next week
			if (weekNum < maxWeeks) {
				console.log(
					`[CONTENT] Moving to next week (${weekNum + 1})...`
				);
				const success = await clickNextWeekAndWait();

				if (!success) {
					console.warn(
						`[CONTENT] Failed to navigate to week ${
							weekNum + 1
						}, stopping extraction`
					);
					break;
				}

				console.log(
					`[CONTENT] Successfully navigated to week ${weekNum + 1}`
				);
			}
		} catch (error) {
			console.error(`[CONTENT] Error processing week ${weekNum}:`, error);
			// Continue with next week instead of stopping entirely
			if (weekNum < maxWeeks) {
				try {
					await clickNextWeekAndWait();
				} catch (navError) {
					console.error(
						"[CONTENT] Navigation error, stopping extraction:",
						navError
					);
					break;
				}
			}
		}
	}

	for (let weekNum = maxWeeks; weekNum >= 1; weekNum--) {
		if (weekNum > 1) {
			console.log(
				`[CONTENT] Moving to previous week (${weekNum - 1})...`
			);
			const success = await clickPreviousWeekAndWait();

			if (!success) {
				console.warn(
					`[CONTENT] Failed to navigate to week ${
						weekNum - 1
					}, stopping extraction`
				);
				break;
			}

			console.log(
				`[CONTENT] Successfully navigated to week ${weekNum - 1}`
			);
		}
	}

	console.log("[CONTENT] Multi-store, multi-week extraction completed");
	console.log(
		"[CONTENT] Total shifts across all stores and weeks:",
		allSchedules.length
	);

	if (allSchedules.length === 0) {
		throw new Error(
			"No scheduled shifts found across any stores or weeks."
		);
	}

	// Generate both ICS and API-ready JSON
	const icsContent = generateICS(allSchedules);
	const apiData = generateAPIData(allSchedules);

	console.log(
		"[CONTENT] Generated ICS for all stores/weeks, content length:",
		icsContent.length
	);
	console.log("[CONTENT] Generated API data:", apiData);

	return {
		success: true,
		schedule: allSchedules,
		icsContent: icsContent,
		apiData: apiData,
		weeksProcessed: Math.min(
			maxWeeks,
			allSchedules.length > 0 ? maxWeeks : 1
		),
		storesProcessed: stores.length,
	};
}

// MARK: Navigate to Tab
// work, profile, schedules
function navigateAccountToTab(name) {
	console.log("[CONTENT] Navigating account to tab:", name);
	document.querySelector(`#myaccount-${name}-tab`).closest("li").click();
}

// MARK: Get Store List
async function getStoreList() {
	console.log("[CONTENT] Getting store list...");

	// // First, click the store button to open dropdown if it's not already open
	// const storeButton = document.querySelector(
	// 	"#myaccount-schedule-weekpicker-scheduletype-store-button"
	// );
	// if (!storeButton) {
	// 	console.error("[CONTENT] Store button not found");
	// 	return [];
	// }

	// console.log("[CONTENT] Store button found, clicking to open dropdown...");
	// storeButton.click();

	// // Wait a moment for dropdown to appear
	// await new Promise((resolve) => setTimeout(resolve, 300));

	console.log(
		"[CONTENT] No need to click store button, can get dropdown directly"
	);

	// Get the dropdown list
	const dropdown = document.querySelector(
		"#myaccount-schedule-weekpicker-scheduletype-store-dropdown"
	);
	if (!dropdown) {
		console.error("[CONTENT] Store dropdown not found");
		return [];
	}

	console.log("[CONTENT] Store dropdown found");

	// Extract store information
	const storeItems = dropdown.querySelectorAll("li[data-storeid]");
	const stores = [];

	storeItems.forEach((item, index) => {
		const storeId = item.getAttribute("data-storeid");
		const link = item.querySelector("a");
		const storeName = link
			? link.textContent.split("'s")[0].trim()
			: `Store ${index + 1}`;

		stores.push({
			id: storeId,
			name: storeName,
			element: item,
		});

		console.log(`[CONTENT] Found store: ${storeName} (ID: ${storeId})`);
	});

	console.log(`[CONTENT] Total stores found: ${stores.length}`);
	return stores;
}

// MARK: Select Store and Wait
async function selectStoreAndWait(store) {
	return new Promise((resolve) => {
		console.log(`[CONTENT] Selecting store: ${store.name} (${store.id})`);

		// Find the store dropdown button
		const storeDropdownButton = document.querySelector(
			"#myaccount-schedule-weekpicker-scheduletype-store-button"
		);
		if (!storeDropdownButton) {
			console.error("[CONTENT] Store dropdown button not found");
			resolve(false);
			return;
		}

		// Click to open dropdown
		storeDropdownButton.click();

		setTimeout(() => {
			// Find the specific store item
			const dropdown = document.querySelector(
				"#myaccount-schedule-weekpicker-scheduletype-store-dropdown"
			);
			if (!dropdown) {
				console.error(
					"[CONTENT] Store dropdown not found after opening"
				);
				resolve(false);
				return;
			}

			const storeItem = dropdown.querySelector(
				`li[data-storeid="${store.id}"]`
			);
			if (!storeItem) {
				console.error(
					`[CONTENT] Store item not found for ID: ${store.id}`
				);
				resolve(false);
				return;
			}

			console.log(
				`[CONTENT] Found store item for ${store.name}, clicking...`
			);

			// Click the store item
			const storeLink = storeItem.querySelector("a");
			if (storeLink) {
				storeLink.click();
			} else {
				storeItem.click();
			}

			// Wait for loading to complete using the progress indicator
			let attempts = 0;
			const maxAttempts = 50; // 10 seconds max wait (200ms * 50)
			let loadingStarted = false;

			const checkForLoadingComplete = () => {
				attempts++;

				// Find the progress indicator
				const progressIndicator = document.querySelector(
					"#myaccount-schedule-periodselect .progress"
				);

				if (progressIndicator) {
					const isLoading =
						!progressIndicator.classList.contains("hide");
					console.log(
						`[CONTENT] Attempt ${attempts}: Progress indicator isLoading: ${isLoading} (classes: "${progressIndicator.className}")`
					);

					if (isLoading && !loadingStarted) {
						console.log(
							"[CONTENT] Loading started - progress indicator visible"
						);
						loadingStarted = true;
					} else if (!isLoading && loadingStarted) {
						console.log(
							"[CONTENT] Loading completed - progress indicator hidden"
						);

						// Give it a little more time to ensure everything is fully loaded
						setTimeout(() => {
							resolve(true);
						}, 500);
						return;
					} else if (!isLoading && !loadingStarted && attempts > 5) {
						// If we haven't seen loading start after a few attempts, assume it's already loaded
						console.log(
							"[CONTENT] No loading detected after initial attempts - assuming already loaded"
						);
						setTimeout(() => {
							resolve(true);
						}, 300);
						return;
					}
				} else {
					console.log(
						`[CONTENT] Attempt ${attempts}: Progress indicator not found`
					);
					if (attempts > 10) {
						console.log(
							"[CONTENT] Progress indicator not found, assuming load complete"
						);
						resolve(true);
						return;
					}
				}

				if (attempts >= maxAttempts) {
					console.warn(
						"[CONTENT] Timeout waiting for store loading to complete"
					);
					resolve(false);
					return;
				}

				// Check again in 200ms
				setTimeout(checkForLoadingComplete, 200);
			};

			// Start checking for loading state changes after a brief delay
			setTimeout(checkForLoadingComplete, 200);
		}, 300); // Wait for dropdown to open
	});
}

// MARK: Get Current Week Info
function getCurrentWeekInfo() {
	const periodSelector = document.querySelector(
		"#myaccount-schedule-periodselect .flex-full span"
	);
	if (periodSelector) {
		const weekText = periodSelector.textContent.trim();
		console.log("[CONTENT] Current week display text:", weekText);
		return weekText;
	}
	return "Unknown week";
}

// MARK: Click Previous Week and Wait
async function clickPreviousWeekAndWait() {
	console.log("[CONTENT] Looking for next week button...");

	// Find the next week button
	const prevButton = document.querySelector(
		"#myaccount-schedule-periodselect .flex-auto.ml-2 a .mdi-chevron-left"
	);

	if (!prevButton) {
		console.error("[CONTENT] Previous week button not found");
		console.log("[CONTENT] Available chevron elements:");
		document
			.querySelectorAll(".mdi-chevron-right, .mdi-chevron-left")
			.forEach((el, i) => {
				console.log(
					`  ${i}: ${el.className} in ${el.parentElement?.className}`
				);
			});
		resolve(false);
		return;
	}

	console.log("[CONTENT] Previous week button found:", prevButton);
	return clickWeekButtonAndWait(prevButton);
}
// MARK: Click Next Week and Wait
async function clickNextWeekAndWait() {
	console.log("[CONTENT] Looking for next week button...");

	// Find the next week button
	const nextButton = document.querySelector(
		"#myaccount-schedule-periodselect .flex-auto.ml-2 a .mdi-chevron-right"
	);

	if (!nextButton) {
		console.error("[CONTENT] Next week button not found");
		console.log("[CONTENT] Available chevron elements:");
		document
			.querySelectorAll(".mdi-chevron-right, .mdi-chevron-left")
			.forEach((el, i) => {
				console.log(
					`  ${i}: ${el.className} in ${el.parentElement?.className}`
				);
			});
		resolve(false);
		return;
	}

	console.log("[CONTENT] Next week button found:", nextButton);

	return clickWeekButtonAndWait(nextButton);
}
// MARK: Click Week Button and Wait
async function clickWeekButtonAndWait(button) {
	return new Promise((resolve) => {
		// Get current week info to detect change
		const currentWeekBefore = getCurrentWeekInfo();
		console.log("[CONTENT] Week before click:", currentWeekBefore);

		// Set up change detection
		let changeDetected = false;
		let attempts = 0;
		const maxAttempts = 50; // 5 seconds max wait

		const checkForChange = () => {
			attempts++;
			const currentWeekAfter = getCurrentWeekInfo();

			console.log(
				`[CONTENT] Attempt ${attempts}: Checking for change... "${currentWeekBefore}" vs "${currentWeekAfter}"`
			);

			if (currentWeekAfter !== currentWeekBefore) {
				console.log("[CONTENT] Week change detected!");
				changeDetected = true;

				// Give it a little more time to fully load the schedule
				setTimeout(() => {
					resolve(true);
				}, 200);
				return;
			}

			if (attempts >= maxAttempts) {
				console.warn("[CONTENT] Timeout waiting for week change");
				resolve(false);
				return;
			}

			// Check again in 100ms
			setTimeout(checkForChange, 100);
		};

		// Click the button (click the parent link, not the icon)
		const linkButton = button.closest("a");
		if (linkButton) {
			console.log("[CONTENT] Clicking next week link...");
			linkButton.click();

			// Start checking for changes
			setTimeout(checkForChange, 100);
		} else {
			console.error(
				"[CONTENT] Could not find link parent of next button"
			);
			resolve(false);
		}
	});
}

// MARK: Parse Time String
function parseTimeString(timeStr) {
	const [time, period] = timeStr.split(" ");
	let [hours, minutes] = time.split(":").map(Number);

	if (period === "PM" && hours !== 12) {
		hours += 12;
	} else if (period === "AM" && hours === 12) {
		hours = 0;
	}

	return { hours, minutes };
}

// MARK: Format Date Time
function formatDateTime(date, time) {
	const { hours, minutes } = parseTimeString(time);
	const dateTime = new Date(date);
	dateTime.setHours(hours, minutes, 0, 0);
	return dateTime.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function formatDateTimeISO(date, time) {
	const { hours, minutes } = parseTimeString(time);
	const dateTime = new Date(date);
	dateTime.setHours(hours, minutes, 0, 0);
	return dateTime.toISOString();
}

function formatEmployeeName(name) {
	if (!name) return "";
	const parts = name.split(" ");
	if (!Array.isArray(parts) || parts.length === 0) return "";
	if (parts.length === 1) return parts[0];
	return `${parts[0]} ${parts[parts.length - 1]}`;
}

// MARK: Parse Schedule HTML
function parseScheduleHTML() {
	console.log("[CONTENT] Starting HTML parsing for all employees...");

	// Get current store info
	const currentStoreInfo = getCurrentStoreInfo();
	console.log("[CONTENT] Current store info:", currentStoreInfo);

	// Extract date info from the period selector
	const periodSelector = document.querySelector(
		"#myaccount-schedule-periodselect span"
	);
	console.log("[CONTENT] Period selector element found:", !!periodSelector);

	let baseDate = new Date(); // fallback to current date

	if (periodSelector) {
		const periodText = periodSelector.textContent;
		console.log("[CONTENT] Period text:", periodText);

		const dateMatch = periodText.match(/Week of (\w+) (\d+), (\d+)/);
		console.log("[CONTENT] Date match result:", dateMatch);

		if (dateMatch) {
			const [, monthStr, day, year] = dateMatch;
			console.log(
				"[CONTENT] Extracted date parts - month:",
				monthStr,
				"day:",
				day,
				"year:",
				year
			);

			const monthMap = {
				Jan: 0,
				Feb: 1,
				Mar: 2,
				Apr: 3,
				May: 4,
				Jun: 5,
				Jul: 6,
				Aug: 7,
				Sep: 8,
				Oct: 9,
				Nov: 10,
				Dec: 11,
			};

			const month = monthMap[monthStr];
			if (month !== undefined) {
				baseDate = new Date(parseInt(year), month, parseInt(day));
				console.log("[CONTENT] Base date set to:", baseDate);
			} else {
				console.warn("[CONTENT] Unknown month string:", monthStr);
			}
		}
	} else {
		console.warn("[CONTENT] Period selector not found, using current date");
	}

	const scheduleItems = document.querySelectorAll(
		"#myaccount-schedule-overview li"
	);
	console.log("[CONTENT] Found schedule items:", scheduleItems.length);

	if (scheduleItems.length === 0) {
		console.warn(
			"[CONTENT] No schedule items found. Looking for alternative selectors..."
		);
		const alternativeSelectors = [
			".collapsible",
			'ul[id*="schedule"]',
			".schedule-item",
		];
		alternativeSelectors.forEach((selector) => {
			const elements = document.querySelectorAll(selector);
			console.log(
				`[CONTENT] Found ${elements.length} elements for selector: ${selector}`
			);
		});
	}

	const schedule = [];

	let previousDay = null;
	let currentMonth = baseDate.getMonth();
	let currentYear = baseDate.getFullYear();

	console.log(
		"[CONTENT] Starting iteration with month:",
		currentMonth,
		"year:",
		currentYear
	);

	scheduleItems.forEach((item, index) => {
		console.log(
			`[CONTENT] Processing item ${index + 1}/${scheduleItems.length}`
		);

		const dayElement = item.querySelector(
			".collapsible-header .H1DarkLeft"
		);
		const bodyElement = item.querySelector(".collapsible-body");

		console.log(
			`[CONTENT] Item ${index + 1} - dayElement found:`,
			!!dayElement,
			"bodyElement found:",
			!!bodyElement
		);

		if (!dayElement || !bodyElement) {
			console.log(
				`[CONTENT] Skipping item ${
					index + 1
				} - missing required elements`
			);
			return;
		}

		const day = parseInt(dayElement.textContent);
		const hasNoSchedule =
			bodyElement.textContent.includes("No schedule") ||
			bodyElement.textContent.includes("Not scheduled");

		console.log(
			`[CONTENT] Item ${index + 1} - day:`,
			day,
			"hasNoSchedule:",
			hasNoSchedule,
			"previousDay:",
			previousDay
		);

		// Handle month transitions - if current day is less than previous day, we've moved to next month
		if (previousDay !== null && day < previousDay) {
			console.log(
				`[CONTENT] Month transition detected (${previousDay} -> ${day})`
			);
			currentMonth++;
			if (currentMonth > 11) {
				currentMonth = 0;
				currentYear++;
				console.log("[CONTENT] Year rolled over to:", currentYear);
			}
			console.log("[CONTENT] New month:", currentMonth);
		}
		previousDay = day;

		if (!hasNoSchedule) {
			console.log(
				`[CONTENT] Item ${
					index + 1
				} has schedules, extracting all employee shifts...`
			);

			// Find all employee shift rows (.row.mar-bot)
			const shiftRows = bodyElement.querySelectorAll(".row.mar-bot");
			console.log(
				`[CONTENT] Item ${index + 1} found ${
					shiftRows.length
				} employee shifts`
			);

			shiftRows.forEach((row, rowIndex) => {
				console.log(
					`[CONTENT] Item ${index + 1} processing shift ${
						rowIndex + 1
					}/${shiftRows.length}`
				);

				const employeeElements = row.querySelectorAll(".B1DarkLeft");
				const roleElement = row.querySelector(".B1LightLeft");
				const pendingElement = row.querySelector(
					".LabelPrimaryCenter.btn-vertical.orange-text"
				);

				if (pendingElement) {
					// Skip this shift
					console.log(
						`[CONTENT] Item ${index + 1} shift ${
							rowIndex + 1
						} is pending`
					);
					return;
				}

				console.log(
					`[CONTENT] Item ${index + 1} shift ${
						rowIndex + 1
					} - found ${
						employeeElements.length
					} B1DarkLeft elements, roleElement:`,
					!!roleElement
				);

				if (employeeElements.length >= 2 && roleElement) {
					const employeeName = formatEmployeeName(
						employeeElements[0].textContent.trim()
					);
					const timeText = employeeElements[1].textContent.trim();
					const role = roleElement.textContent.trim();

					console.log(
						`[CONTENT] Item ${index + 1} shift ${
							rowIndex + 1
						} extracted - employee: "${employeeName}", time: "${timeText}", role: "${role}"`
					);

					if (employeeName === "Open Shift") {
						return;
					}

					if (timeText.includes(" - ")) {
						const [startTime, endTime] = timeText.split(" - ");

						// Use the tracked month and year for this specific event
						const eventDate = new Date(
							currentYear,
							currentMonth,
							day
						);

						console.log(
							`[CONTENT] Item ${index + 1} shift ${
								rowIndex + 1
							} creating event - date:`,
							eventDate,
							"start:",
							startTime.trim(),
							"end:",
							endTime.trim()
						);

						schedule.push({
							date: eventDate,
							startTime: startTime.trim(),
							endTime: endTime.trim(),
							employeeName: employeeName,
							role: role,
							day: day,
							dayOfWeek: [
								"Sunday",
								"Monday",
								"Tuesday",
								"Wednesday",
								"Thursday",
								"Friday",
								"Saturday",
							][eventDate.getDay()],
							storeId: currentStoreInfo.id,
							storeName: currentStoreInfo.name,
						});

						console.log(
							`[CONTENT] Item ${index + 1} shift ${
								rowIndex + 1
							} added to schedule. Total events:`,
							schedule.length
						);
					} else {
						console.warn(
							`[CONTENT] Item ${index + 1} shift ${
								rowIndex + 1
							} time format invalid: "${timeText}"`
						);
					}
				} else {
					console.warn(
						`[CONTENT] Item ${index + 1} shift ${
							rowIndex + 1
						} missing required elements - B1DarkLeft count:`,
						employeeElements.length,
						"roleElement:",
						!!roleElement
					);
				}
			});
		} else {
			console.log(
				`[CONTENT] Item ${
					index + 1
				} has no schedules (store closed or no shifts)`
			);
		}
	});

	console.log("[CONTENT] Final schedule:", schedule);
	console.log("[CONTENT] Total shifts parsed:", schedule.length);
	return schedule;
}

async function parseSelfHTML() {
	console.log("[CONTENT] Starting self extraction...");

	const url = "dashboard.crispnow.com/fiizdrinks/#myaccount";

	const tab = document.getElementById("myaccount-profile-tab");
	// Click then wait

	await extractSelfFromProfile();
}

// MARK: Parse User HTML
async function parseUserHTML() {
	console.log("[CONTENT] Starting user extraction...");

	const container = document.querySelector("#management-users-jobs");
	if (!container) {
		console.error(
			"[CONTENT] User container not found. Available IDs on page:"
		);
		const allIds = Array.from(document.querySelectorAll("[id]")).map(
			(el) => el.id
		);
		console.log("[CONTENT] Page IDs:", allIds);
		throw new Error("User management container not found on this page.");
	}

	console.log("[CONTENT] User container found");

	const items = container.querySelectorAll(".row.no-mar-bot.clickable");
	console.log(`[CONTENT] Found ${items.length} user rows to process`);

	if (items.length === 0) {
		console.warn("[CONTENT] No clickable user rows found.");
		throw new Error("No users found on this page.");
	}

	const allUsers = [];

	for (let i = 0; i < items.length; i++) {
		const row = items[i];
		console.log(
			`[CONTENT] ===== Processing user ${i + 1}/${items.length} =====`
		);

		try {
			// Click user and wait for modal
			const userData = await clickUserAndWait(row, i);

			if (userData) {
				allUsers.push(userData);
				console.log(
					`[CONTENT] User ${i + 1} data extracted successfully`
				);

				// Close the modal before proceeding to next user
				await closeUserModal();
			} else {
				console.warn(
					`[CONTENT] Failed to extract data for user ${i + 1}`
				);
			}
		} catch (userError) {
			console.error(
				`[CONTENT] Error processing user ${i + 1}:`,
				userError
			);
			// Try to close modal in case it's open
			await closeUserModal();
			// Continue with next user instead of stopping		}
		}

		// Small delay between users to avoid overwhelming the UI
		await new Promise((resolve) => setTimeout(resolve, 200));
	}

	console.log("[CONTENT] User extraction completed");
	console.log(`[CONTENT] Total users extracted: ${allUsers.length}`);

	if (allUsers.length === 0) {
		throw new Error("No user data could be extracted.");
	}

	return {
		success: true,
		users: allUsers,
		totalProcessed: items.length,
		successfulExtractions: allUsers.length,
	};
}

// MARK: Click User and Wait
async function clickUserAndWait(row, index) {
	return new Promise((resolve) => {
		// Store initial modal state
		const modal = document.getElementById("management-users-user-modal");
		const initialModalVisible = modal && modal.style.display !== "none";

		console.log(`[CONTENT] User ${index + 1} - Initial modal state:`, {
			modalExists: !!modal,
			initiallyVisible: initialModalVisible,
		});

		// Click the user row
		console.log(`[CONTENT] User ${index + 1} - Clicking row...`);
		row.click();

		let attempts = 0;
		const maxAttempts = 50; // 10 seconds max wait (200ms * 50)

		const checkForModalAndExtractData = () => {
			attempts++;
			console.log(
				`[CONTENT] User ${
					index + 1
				} - Attempt ${attempts}: Checking for modal...`
			);

			const modal = document.getElementById(
				"management-users-user-modal"
			);

			if (!modal) {
				console.warn(
					`[CONTENT] User ${
						index + 1
					} - Attempt ${attempts}: Modal element not found`
				);

				if (attempts >= maxAttempts) {
					console.error(
						`[CONTENT] User ${
							index + 1
						} - Timeout: Modal never appeared`
					);
					resolve(null);
					return;
				}

				setTimeout(checkForModalAndExtractData, 200);
				return;
			}

			// Check if modal is visible
			const modalVisible = modal.classList.contains("open");

			console.log(
				`[CONTENT] User ${
					index + 1
				} - Attempt ${attempts}: Modal visibility check:`,
				{
					displayStyle: modal.style.display,
					modalVisible: modalVisible,
				}
			);

			if (!modalVisible) {
				if (attempts >= maxAttempts) {
					console.error(
						`[CONTENT] User ${
							index + 1
						} - Timeout: Modal never became visible`
					);
					resolve(null);
					return;
				}

				setTimeout(checkForModalAndExtractData, 200);
				return;
			}

			// Modal is visible, now check for content
			console.log(
				`[CONTENT] User ${
					index + 1
				} - Modal is visible, checking for content...`
			);

			const profileTab = modal.querySelector(
				"div#management-users-user-profile-tab"
			);

			if (!profileTab) {
				console.warn(
					`[CONTENT] User ${
						index + 1
					} - Attempt ${attempts}: Profile tab not found`
				);

				if (attempts >= maxAttempts) {
					console.error(
						`[CONTENT] User ${
							index + 1
						} - Timeout: Profile tab never appeared`
					);
					resolve(null);
					return;
				}

				setTimeout(checkForModalAndExtractData, 200);
				return;
			}

			// Extract user data from the modal
			console.log(
				`[CONTENT] User ${
					index + 1
				} - Profile tab found, extracting data...`
			);

			try {
				const userData = extractUserDataFromModal(
					modal,
					profileTab,
					index
				);
				console.log(
					`[CONTENT] User ${index + 1} - Data extraction successful:`,
					userData
				);
				resolve(userData);
			} catch (extractError) {
				console.error(
					`[CONTENT] User ${index + 1} - Error extracting data:`,
					extractError
				);
				resolve(null);
			}
		};

		// Start checking for modal after a brief delay
		setTimeout(checkForModalAndExtractData, 300);
	});
}

// MARK: Extract Self Profile Store Options
async function extractSelfProfileStoreOptions() {
	console.log("[CONTENT] Extracting store options for self profile...");

	const container = document.querySelector("#myaccount-profile-tab");
	if (!container) {
		throw new Error("Profile tab not found");
	}

	const pincodeContainer = container.querySelector("#myaccount-profile-pos");
	if (!pincodeContainer) {
		throw new Error("Pincode container not found");
	}

	const pinOptions = document.querySelectorAll(
		"#myaccount-profile-pos-showpin-dropdown li[data-storeid]"
	);

	if (pinOptions.length === 0) {
		throw new Error("No store options found");
	}

	const stores = [];
	pinOptions.forEach((option, index) => {
		const optionText = option.textContent.trim();
		const match = optionText.match(/^Show (.+?)'s pin$/);
		const storeName = match ? match[1] : optionText;
		const storeId = option.getAttribute("data-storeid");

		stores.push({
			index: index,
			name: storeName,
			id: storeId,
			fullText: optionText,
		});
	});

	console.log("[CONTENT] Found store options:", stores);

	return {
		success: true,
		needsStoreSelection: true,
		stores: stores,
	};
}

// MARK: Complete Self Profile Extraction
async function completeSelfProfileExtraction(storeId, storeName) {
	console.log(
		"[CONTENT] Completing self profile extraction with store id:",
		storeId
	);
	if (!storeId || !storeName) {
		console.error("[CONTENT] No store id or name provided");
		return { success: false, error: "No store id or name provided" };
	}

	const container = document.querySelector("#myaccount-profile-tab");
	if (!container) {
		throw new Error("Profile tab not found");
	}

	const storeLink = document.querySelector(
		`#myaccount-profile-pos-showpin-dropdown li[data-storeid="${storeId}"]`
	);
	if (storeLink) {
		console.log("[CONTENT] Clicking store option to reveal pincode...");
		storeLink.click();
	} else {
		console.log("[CONTENT] No store found, could not complete extraction");
		return { success: false, error: "No store option found" };
	}

	const pincode = await waitForPinReveal();

	if (!pincode) {
		console.warn("[CONTENT] Could not retrieve pincode");
	}

	// Now extract all the data
	const userData = {
		extractedAt: new Date().toISOString(),
	};

	try {
		const fullName = container.querySelector(
			"#myaccount-profile-profile-header"
		);
		const profile = container.querySelector(
			"#myaccount-profile-profile-details"
		);
		const email = profile.querySelector("[data-id='email'] .B2DarkLeft");
		const phone = profile.querySelector("[data-id='phone'] .B2DarkLeft");

		userData.fullName = fullName ? fullName.textContent.trim() : "";
		const splitName = userData.fullName.split(" ");
		userData.firstName = splitName[0] || "";
		userData.lastName = splitName[splitName.length - 1] || "";
		userData.email = email ? email.textContent.trim() : "";
		userData.phone = phone ? phone.textContent.trim() : "";
		userData.store = {
			name: storeName,
			id: storeId,
		};
		userData.pincode = pincode || "";

		console.log("[CONTENT] Self data extracted:", userData);

		return {
			success: true,
			user: userData,
		};
	} catch (error) {
		console.error("[CONTENT] Error extracting self data:", error);
		throw error;
	}
}

// MARK: Wait for Pin Reveal
async function waitForPinReveal() {
	return new Promise((resolve) => {
		let attempts = 0;
		const maxAttempts = 25; // 5 seconds max wait (200ms * 25);

		const checkForRevealedPin = () => {
			attempts++;
			console.log(
				`[CONTENT] Self - Attempt ${attempts}: Checking for pin...`
			);

			const pin = document.querySelector(
				"#myaccount-profile-tab #myaccount-profile-pos #myaccount-profile-pos-pin"
			);

			if (!pin) {
				console.warn(
					`[CONTENT] Self - Attempt ${attempts}: Pin element not found`
				);

				if (attempts >= maxAttempts) {
					console.error(
						`[CONTENT] Self - Timeout: Pin never revealed`
					);
					resolve(null);
					return;
				}

				setTimeout(checkForRevealedPin, 200);
				return;
			}

			// Check if modal is visible
			const pinRevealed = !pin.classList.contains("hidden-pin");

			console.log(
				`[CONTENT] Self - Attempt ${attempts}: Pin visibility check:`,
				{
					pinRevealed: pinRevealed,
					classes: pin.className,
				}
			);

			if (!pinRevealed) {
				if (attempts >= maxAttempts) {
					console.error(
						`[CONTENT] Self - Timeout: Pin never became revealed`
					);
					resolve(null);
					return;
				}

				setTimeout(checkForRevealedPin, 200);
				return;
			}

			// Extract code from the pin
			console.log(`[CONTENT] Self - Pin is revealed, extracting code...`);

			try {
				const pincode = document
					.querySelector(
						"#myaccount-profile-pos #myaccount-profile-pos-pin"
					)
					?.textContent.trim();
				console.log(
					`[CONTENT] Self - Code extraction successful:`,
					pincode
				);
				resolve(pincode);
			} catch (extractError) {
				console.error(
					`[CONTENT] Self - Error extracting pincode:`,
					extractError
				);
				resolve(null);
			}
		};

		// Start checking after a brief delay
		setTimeout(checkForRevealedPin, 200);
	});
}

// MARK: Extract User Data From Modal
function extractUserDataFromModal(modal, profileTab, index) {
	console.log(
		`[CONTENT] Extracting data from modal for user ${index + 1}...`
	);

	const userData = {
		extractedAt: new Date().toISOString(),
	};

	try {
		// Extract basic user information
		const firstName = profileTab.querySelector(
			"#management-users-user-firstname-input"
		);
		const lastName = profileTab.querySelector(
			"#management-users-user-lastname-input"
		);
		const email = profileTab.querySelector(
			"#management-users-user-email-input"
		);
		const phone = profileTab.querySelector(
			"#management-users-user-phone-input"
		);

		console.log(`[CONTENT] User ${index + 1} - Found form elements:`, {
			firstName: !!firstName,
			lastName: !!lastName,
			email: !!email,
			phone: !!phone,
		});

		// Extract values with fallbacks
		userData.firstName = firstName ? firstName.value.trim() : "";
		userData.lastName = lastName ? lastName.value.trim() : "";
		userData.email = email ? email.value.trim() : "";
		userData.phone = phone ? phone.value.trim() : "";
		userData.fullName = `${userData.firstName} ${userData.lastName}`.trim();

		console.log(`[CONTENT] User ${index + 1} - Basic info extracted:`, {
			firstName: userData.firstName,
			lastName: userData.lastName,
			email: userData.email,
			phone: userData.phone,
		});

		// Extract pincode and store information
		const pincodeContainer = profileTab.querySelector(
			"#management-users-user-pincodes-dropdown"
		);

		if (pincodeContainer) {
			console.log(
				`[CONTENT] User ${
					index + 1
				} - Pincode container found, extracting store/pincode...`
			);

			const storeElement = pincodeContainer.querySelector(".left");
			const pincodeElement = pincodeContainer.querySelector(".right");

			userData.store = storeElement
				? storeElement.textContent.trim()
				: "";
			userData.pincode = pincodeElement
				? pincodeElement.textContent.trim()
				: "";

			console.log(
				`[CONTENT] User ${index + 1} - Store/pincode extracted:`,
				{
					store: userData.store,
					pincode: userData.pincode,
				}
			);
		} else {
			console.warn(
				`[CONTENT] User ${index + 1} - Pincode container not found`
			);
			userData.store = "";
			userData.pincode = "";
		}

		// Validate that we got meaningful data
		const hasMinimalData =
			userData.firstName || userData.lastName || userData.email;

		if (!hasMinimalData) {
			console.warn(
				`[CONTENT] User ${index + 1} - No meaningful data extracted`
			);
			userData.warning = "No meaningful data found in modal";
		}

		console.log(
			`[CONTENT] User ${index + 1} - Final extracted data:`,
			userData
		);
		return userData;
	} catch (error) {
		console.error(
			`[CONTENT] User ${index + 1} - Error during data extraction:`,
			error
		);
		userData.error = error.message;
		return userData;
	}
}

// MARK: Close User Modal
async function closeUserModal() {
	return new Promise((resolve) => {
		console.log("[CONTENT] Attempting to close user modal...");

		const modal = document.getElementById("management-users-user-modal");

		if (!modal) {
			console.log("[CONTENT] No modal found to close");
			resolve(true);
			return;
		}

		const footer = modal.querySelector(".modal-footer");
		if (!footer) {
			console.log("[CONTENT] No footer found in modal, cannot close");
			resolve(true);
			return;
		}

		// Look for close button or overlay
		const closeButton = footer.querySelector(
			"#management-users-user-cancel-button"
		);
		const overlay = document.querySelector(".modal-overlay");

		console.log("[CONTENT] Modal close options found:", {
			closeButton: !!closeButton,
			overlay: !!overlay,
		});

		let closeAction = null;

		if (closeButton) {
			console.log("[CONTENT] Clicking close button...");
			closeButton.click();
			closeAction = "button";
		} else if (overlay) {
			console.log("[CONTENT] Clicking overlay to close...");
			overlay.click();
			closeAction = "overlay";
		} else {
			// Try pressing escape key
			console.log("[CONTENT] Trying escape key...");
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape" })
			);
			closeAction = "escape";
		}

		// Wait for modal to close
		let attempts = 0;
		const maxAttempts = 5; // 5 seconds max wait

		const checkModalClosed = () => {
			attempts++;

			const modal = document.getElementById(
				"management-users-user-modal"
			);
			const overlay = document.querySelector(".modal-overlay");
			const modalVisible = modal?.classList.contains("open") || !!overlay;

			console.log(
				`[CONTENT] Close attempt ${attempts}: Modal still visible: ${modalVisible}, overlay visible: ${!!overlay}`
			);
			console.log(
				"[CONTENT] Reasoning:",
				`containsClass: ${modal?.classList.contains(
					"open"
				)}, overlay: ${!!overlay}`
			);

			if (!modalVisible) {
				console.log(
					`[CONTENT] Modal closed successfully using ${closeAction}`
				);
				resolve(true);
				return;
			}

			if (attempts >= maxAttempts) {
				console.warn(
					"[CONTENT] Timeout waiting for modal to close, continuing anyway"
				);
				resolve(false);
				return;
			}

			setTimeout(checkModalClosed, 200);
		};

		setTimeout(checkModalClosed, 300);
	});
}

// MARK: Get Current Store Info
function getCurrentStoreInfo() {
	const storeButton = document.querySelector(
		"#myaccount-schedule-weekpicker-scheduletype-store-button span"
	);
	const storeText = storeButton
		? storeButton.textContent.trim()
		: "Unknown Store";

	// Try to extract store ID from dropdown if available
	let storeId = "unknown";
	const dropdown = document.querySelector(
		"#myaccount-schedule-weekpicker-scheduletype-store-dropdown"
	);
	if (dropdown) {
		const activeStore = Array.from(
			dropdown.querySelectorAll("li[data-storeid]")
		).find((item) => {
			const link = item.querySelector("a");
			return (
				link &&
				storeText.includes(link.textContent.replace("'s schedule", ""))
			);
		});

		if (activeStore) {
			storeId = activeStore.getAttribute("data-storeid");
		}
	}

	console.log(
		"[CONTENT] Current store info - ID:",
		storeId,
		"Name:",
		storeText
	);
	return {
		id: storeId,
		name: storeText,
	};
}

// MARK: Generate Shift UID
function generateShiftUID(shift) {
	const dateStr = `${shift.date.getFullYear()}${String(
		shift.date.getMonth() + 1
	).padStart(2, "0")}${String(shift.date.getDate()).padStart(2, "0")}`;
	const employeeName = shift.employeeName.toLowerCase().replace(/\s+/g, "-");
	const role = shift.role.toLowerCase().replace(/\s+/g, "-");

	// Create a hash of start time + end time for uniqueness
	const timeSignature = btoa(`${shift.startTime}-${shift.endTime}`).slice(
		0,
		8
	);

	// Include start time in UID for uniqueness
	const uid = `shift-${dateStr}-${shift.storeId}-${employeeName}-${role}-${timeSignature}@schedule.local`;

	return uid;
}

// MARK: Generate ICS
function generateICS(schedule) {
	console.log("[CONTENT] Generating ICS for", schedule.length, "shifts");

	const icsLines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Multi-Store Employee Schedule//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"",
	];

	schedule.forEach((shift, index) => {
		console.log(`[CONTENT] Generating ICS shift ${index + 1}:`, shift);

		try {
			const startDateTime = formatDateTime(shift.date, shift.startTime);
			const endDateTime = formatDateTime(shift.date, shift.endTime);
			const uid = generateShiftUID(shift);

			console.log(
				`[CONTENT] Shift ${index + 1} ICS data - start:`,
				startDateTime,
				"end:",
				endDateTime,
				"uid:",
				uid
			);

			icsLines.push(
				"BEGIN:VEVENT",
				`UID:${uid}`,
				`DTSTART:${startDateTime}`,
				`DTEND:${endDateTime}`,
				`SUMMARY:${shift.employeeName} - ${shift.role} (${shift.storeName})`,
				`DESCRIPTION:${shift.employeeName} working as ${shift.role} at ${shift.storeName} from ${shift.startTime} to ${shift.endTime}`,
				`LOCATION:${shift.storeName}`,
				"STATUS:CONFIRMED",
				"TRANSP:OPAQUE",
				"END:VEVENT",
				""
			);

			console.log(`[CONTENT] Shift ${index + 1} added to ICS`);
		} catch (error) {
			console.error(
				`[CONTENT] Error processing shift ${index + 1}:`,
				error,
				shift
			);
		}
	});

	icsLines.push("END:VCALENDAR");

	const result = icsLines.join("\n");
	console.log(
		"[CONTENT] ICS generation complete. Total lines:",
		icsLines.length
	);
	console.log(
		"[CONTENT] Final ICS preview:",
		result.substring(0, 300) + "..."
	);

	return result;
}

// MARK: Generate API Data
function generateAPIData(schedule) {
	console.log("[CONTENT] Generating API data for", schedule.length, "shifts");

	// Group shifts by date and store for easier API consumption
	const shiftsByDate = {};
	const shiftsByEmployee = {};
	const employees = new Set();
	const roles = new Set();
	const stores = new Set();

	schedule.forEach((shift) => {
		const dateKey = shift.date.toISOString().split("T")[0]; // YYYY-MM-DD format

		if (!shiftsByDate[dateKey]) {
			shiftsByDate[dateKey] = {
				date: dateKey,
				dayOfWeek: shift.dayOfWeek,
				stores: {},
			};
		}

		if (!shiftsByDate[dateKey].stores[shift.storeId]) {
			shiftsByDate[dateKey].stores[shift.storeId] = {
				storeId: shift.storeId,
				storeName: shift.storeName,
				shifts: [],
			};
		}

		const shiftData = {
			...shift,
			// employeeName: shift.employeeName,
			// role: shift.role,
			// startTime: shift.startTime,
			// endTime: shift.endTime,
			startDateTime: formatDateTimeISO(shift.date, shift.startTime),
			endDateTime: formatDateTimeISO(shift.date, shift.endTime),
			duration: calculateShiftDuration(shift.startTime, shift.endTime),
		};

		shiftsByDate[dateKey].stores[shift.storeId].shifts.push(shiftData);

		if (!shiftsByEmployee[shift.employeeName]) {
			shiftsByEmployee[shift.employeeName] = {
				employeeName: shift.employeeName,
				totalShifts: 0,
				totalHours: 0,
				stores: new Set(),
				roles: new Set(),
				shifts: [],
			};
		}

		shiftsByEmployee[shift.employeeName].shifts.push(shiftData);
		shiftsByEmployee[shift.employeeName].totalShifts++;
		shiftsByEmployee[shift.employeeName].totalHours +=
			shiftData.duration.totalMinutes / 60;
		shiftsByEmployee[shift.employeeName].stores.add(shift.storeName);
		shiftsByEmployee[shift.employeeName].roles.add(shift.role);

		employees.add(shift.employeeName);
		roles.add(shift.role);
		stores.add(shift.storeName);
	});

	// Convert employee data to final format
	const employeeData = Object.values(shiftsByEmployee).map((employee) => ({
		employeeName: employee.employeeName,
		totalShifts: employee.totalShifts,
		totalHours: Math.round(employee.totalHours * 100) / 100, // Round to 2 decimal places
		stores: Array.from(employee.stores).sort(),
		roles: Array.from(employee.roles).sort(),
		shifts: employee.shifts.sort((a, b) =>
			a.startDateTime.localeCompare(b.startDateTime)
		),
	}));

	// Calculate summary statistics
	const totalShifts = schedule.length;
	const dateRange = Object.keys(shiftsByDate).sort();
	const startDate = dateRange[0];
	const endDate = dateRange[dateRange.length - 1];

	// Calculate shifts per store
	const shiftsByStore = {};
	schedule.forEach((shift) => {
		if (!shiftsByStore[shift.storeName]) {
			shiftsByStore[shift.storeName] = 0;
		}
		shiftsByStore[shift.storeName]++;
	});

	// Calculate hours per employee for metadata
	const hoursPerEmployee = {};
	employeeData.forEach((emp) => {
		hoursPerEmployee[emp.employeeName] = emp.totalHours;
	});

	const apiData = {
		metadata: {
			totalShifts: totalShifts,
			totalEmployees: employees.size,
			totalRoles: roles.size,
			totalStores: stores.size,
			dateRange: {
				start: startDate,
				end: endDate,
			},
			extractedAt: new Date().toISOString(),
			employees: Array.from(employees).sort(),
			roles: Array.from(roles).sort(),
			stores: Array.from(stores).sort(),
			shiftsByStore: shiftsByStore,
			hoursPerEmployee: hoursPerEmployee,
		},
		scheduleData: Object.values(shiftsByDate)
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((day) => ({
				...day,
				stores: Object.values(day.stores),
			})),
		employeeData: employeeData.sort((a, b) =>
			a.employeeName.localeCompare(b.employeeName)
		),
		rawShifts: schedule.map((shift) => ({
			...shift,
			date: shift.date.toISOString().split("T")[0],
			// dayOfWeek: shift.dayOfWeek,
			// employeeName: shift.employeeName,
			// role: shift.role,
			// startTime: shift.startTime,
			// endTime: shift.endTime,
			startDateTime: formatDateTimeISO(shift.date, shift.startTime),
			endDateTime: formatDateTimeISO(shift.date, shift.endTime),
			duration: calculateShiftDuration(shift.startTime, shift.endTime),
			// weekInfo: shift.weekInfo,
			// weekNumber: shift.weekNumber,
			// storeId: shift.storeId,
			// storeName: shift.storeName,
		})),
	};

	console.log("[CONTENT] API data generation complete");
	return apiData;
}

// MARK: Calc Shit Duration
function calculateShiftDuration(startTime, endTime) {
	const start = parseTimeString(startTime);
	const end = parseTimeString(endTime);

	const startMinutes = start.hours * 60 + start.minutes;
	const endMinutes = end.hours * 60 + end.minutes;

	let durationMinutes = endMinutes - startMinutes;

	// Handle overnight shifts (if end time is before start time)
	if (durationMinutes < 0) {
		durationMinutes += 24 * 60; // Add 24 hours
	}

	const hours = Math.floor(durationMinutes / 60);
	const minutes = durationMinutes % 60;

	return {
		totalMinutes: durationMinutes,
		hours: hours,
		minutes: minutes,
		formatted: `${hours}h ${minutes}m`,
	};
}
