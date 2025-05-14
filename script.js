// Create a loading indicator immediately
let loadingIndicatorAdded = false;
function showAppLoading() {
  if (loadingIndicatorAdded) return;
  
  // Loading indicator is already in initial HTML 
  loadingIndicatorAdded = true;
  
  // Add spinner styling with better centering if needed
  const style = document.createElement('style');
  style.textContent = `
    .loading-container {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      width: 100%;
      color: #fff;
      padding: 0;
      margin: 0;
      position: absolute;
      top: 0;
      left: 0;
      z-index: 1000;
      background-color: #1e1e2e;
    }
    .loading-content {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem;
    }
    .loading-spinner {
      width: 60px;
      height: 60px;
      border: 5px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
      margin: 30px 0;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

// Prevent login flash on refresh by checking localStorage first
try {
  const storedAuth = localStorage.getItem('toda_google_auth_token');
  if (!storedAuth) {
    console.log("No stored authentication found");
  } else {
    const authData = JSON.parse(storedAuth);
    if (authData.expiresAt && authData.expiresAt > Date.now()) {
      console.log("Found valid stored token, keeping loading screen");
      // Keep loading indicator, will be replaced with app after init
    } else {
      console.log('Stored token expired');
      localStorage.removeItem('toda_google_auth_token');
    }
  }
} catch (e) {
  console.error('Error checking token on startup:', e);
}

// Load environment variables from env.js
console.log('Attempting to load environment variables from env.js');

fetch('env.js')
  .then(response => {
    if (!response.ok) {
      throw new Error(`Failed to load environment file: ${response.status}`);
    }
    return response.text();
  })
  .then(data => {
    console.log('Successfully loaded env.js, length:', data.length);
    eval(data); // This sets the variables from the env.js file
    console.log('Environment variables loaded successfully');
    initializeApp();
  })
  .catch(error => {
    console.error('Error loading environment variables:', error);
    console.error('Current page URL:', window.location.href);
    document.querySelector('#app').innerHTML = `
      <div class="error-container">
        <h2>Configuration Error</h2>
        <p>Could not load environment variables.</p>
        <p>Error details: ${error.message}</p>
        <p>Please check the browser console for more information.</p>
      </div>
    `;
  });

// Google API configuration
const API_SCOPE = 'https://www.googleapis.com/auth/drive.file ' +
                 'https://www.googleapis.com/auth/drive ' + 
                 'https://www.googleapis.com/auth/drive.readonly ' +
                 'https://www.googleapis.com/auth/drive.metadata.readonly ' +
                 'https://www.googleapis.com/auth/drive.appdata ' +
                 'https://www.googleapis.com/auth/spreadsheets ' +
                 'https://www.googleapis.com/auth/spreadsheets.readonly';
                 
const TOKEN_STORAGE_KEY = 'toda_google_auth_token';
                 
// Global variables
let currentFile = null;
let editorContent = '';
let isAuthenticated = false;
let tokenClient;
let currentFolderId = 'root'; // Start at root folder
let folderBreadcrumbs = [{ id: 'root', name: 'My Drive' }]; // Track folder navigation
let isLoggingOut = false; // Flag to prevent logout loop

function initializeApp() {
  console.log('Initializing app with API key:', GOOGLE_API_KEY?.substring(0, 5) + '...');
  
  // Check if we're in the process of logging out
  if (isLoggingOut) {
    console.log("Logout in progress, redirecting to login page");
    showLoginPage();
    isLoggingOut = false; // Reset the flag
    return;
  }
  
  // We'll restore the token later, after gapi is fully loaded
  let storedToken = null;
  let tokenExpiresAt = null;
  
  // Check for stored token first
  try {
    const storedAuth = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedAuth) {
      const authData = JSON.parse(storedAuth);
      console.log("Found stored auth token, expiry status:", 
                  authData.expiresAt > Date.now() ? "valid" : "expired",
                  "expires in:", Math.round((authData.expiresAt - Date.now())/60000), "minutes");
      
      // Check if token is still valid
      if (authData.expiresAt && authData.expiresAt > Date.now()) {
        console.log('Found valid stored token, will restore after GAPI loads');
        // Save for later
        storedToken = authData.token;
        tokenExpiresAt = authData.expiresAt;
      } else {
        console.log('Stored token expired, removing');
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } else {
      console.log("No stored authentication found");
    }
  } catch (e) {
    console.error('Error parsing stored token:', e);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
  
  // Load the auth2 library first
  gapi.load('client:auth2', {
    callback: function() {
      console.log('GAPI client loaded');
      
      // Restore the token if we have one
      if (storedToken) {
        try {
          gapi.auth.setToken(storedToken);
          isAuthenticated = true;
          console.log("Authentication restored from localStorage");
        } catch (e) {
          console.error("Failed to restore authentication:", e);
          isAuthenticated = false;
        }
      }
      
      // Continue with API initialization
      initGapiClient();
      
      // If authenticated, show the app
      if (isAuthenticated) {
        // Replace login content with the app template
        setTimeout(() => {
          const appTemplate = document.getElementById('app-template');
          document.getElementById('app').innerHTML = appTemplate.innerHTML;
          
          // Initialize app functionality
          initializeAppFunctionality()
            .then(() => {
              console.log("App functionality initialized successfully");
            })
            .catch(error => {
              console.error("Failed to initialize app functionality:", error);
            });
        }, 500); // Delay to make sure GAPI is fully initialized
      }
    },
    onerror: function(error) {
      console.error('Error loading GAPI client:', error);
      document.querySelector('#app').innerHTML = `
        <div class="error-container">
          <h2>Failed to Load Google API</h2>
          <p>Error: ${error?.message || 'Unknown error'}</p>
          <p>Please check your internet connection and try again.</p>
        </div>
      `;
    }
  });
  
  // Setup login button if not already authenticated
  if (!isAuthenticated) {
    // Wait for the Google Identity Services to load
    const checkGisLoaded = setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        clearInterval(checkGisLoaded);
        // Initialize Google Identity Services for login
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: API_SCOPE,
          callback: handleAuthResponse,
        });
        
        showLoginPage();
      }
    }, 100);
  }
}

// Show the login page
function showLoginPage() {
  const appTemplate = document.getElementById('login-template');
  if (appTemplate) {
    document.getElementById('app').innerHTML = appTemplate.innerHTML;
    
    // Make login visible with transition
    setTimeout(() => {
      const loginContainer = document.querySelector('.login-container');
      if (loginContainer) {
        loginContainer.classList.add('visible');
      }
    }, 100);
    
    // Add event listener for login button
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', handleAuthClick);
    }
  }
}

async function initGapiClient() {
  console.log('Initializing GAPI client');
  
  if (!GOOGLE_API_KEY) {
    console.error('GOOGLE_API_KEY is missing or undefined');
    document.querySelector('#app').innerHTML = '<div class="error-container"><h2>Configuration Error</h2><p>API Key is missing.</p></div>';
    return;
  }
  
  try {
    console.log("Attempting to initialize Google API client...");
    
    // Set the API key first
    gapi.client.setApiKey(GOOGLE_API_KEY);
    console.log("API key set successfully");
    
    // Load Drive API
    console.log("Loading Drive API...");
    await new Promise((resolve, reject) => {
      gapi.client.load('drive', 'v3', () => {
        console.log("Drive API loaded successfully");
        resolve();
      });
    });
    
    // Load Sheets API
    await loadSheetsAPI();
    
    console.log("GAPI client fully initialized");
    
    // Init app functionality if already authenticated but not set up
    if (isAuthenticated && !document.getElementById('file-list')) {
      initializeAppFunctionality().catch(error => {
        console.error("Failed to initialize app functionality:", error);
      });
    }
  } catch (error) {
    console.error("Error initializing GAPI client:", error);
    document.querySelector('#app').innerHTML = `
      <div class="error-container">
        <h2>API Error</h2>
        <p>Failed to initialize Google API client.</p>
        <p>Error details: ${error.message || JSON.stringify(error)}</p>
        <p>Please check:</p>
        <ul>
          <li>Your API key is correct and has proper permissions</li>
          <li>The Drive API is enabled in your Google Cloud project</li>
          <li>Your API key restrictions are properly configured</li>
          <li>Try to use the website: ${window.location.origin}${window.location.pathname}</li>
        </ul>
        <button onclick="location.reload()">Try Again</button>
      </div>
    `;
  }
}

async function loadSheetsAPI() {
  console.log("Loading Google Sheets API...");
  
  try {
    // Load the sheets API with timeout
    await new Promise((resolve, reject) => {
      const loadTimeout = setTimeout(() => {
        reject(new Error('Loading Sheets API timed out after 5 seconds'));
      }, 5000);
      
      gapi.client.load('sheets', 'v4')
        .then(() => {
          clearTimeout(loadTimeout);
          console.log("Sheets API loaded successfully");
          resolve();
        })
        .catch(err => {
          clearTimeout(loadTimeout);
          console.error("Error loading Sheets API:", err);
          reject(err);
        });
    });
  } catch (error) {
    console.error("Failed to load Sheets API:", error);
    throw new Error(`Could not load Sheets API: ${error.message}`);
  }
}

function handleAuthClick() {
  if (!isAuthenticated) {
    tokenClient.requestAccessToken({
      prompt: 'consent'
    });
  }
}

function handleAuthResponse(response) {
  if (response.error !== undefined) {
    console.error('Auth error:', response);
    return;
  }
  
  console.log("User successfully authenticated");
  isAuthenticated = true;
  
  // Store the token in localStorage with a longer expiration time
  try {
    const token = gapi.auth.getToken();
    if (token) {
      console.log("Saving token to localStorage");
      // Save token with 12 hours expiration
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
        token: token,
        expiresAt: Date.now() + (12 * 3600 * 1000) // 12 hours
      }));
      console.log("Token saved successfully with expiration in 12 hours");
    } else {
      console.warn("No token available to save");
    }
  } catch (e) {
    console.error('Error saving token to localStorage:', e);
  }
  
  // Replace login content with the app template
  const appTemplate = document.getElementById('app-template');
  document.getElementById('app').innerHTML = appTemplate.innerHTML;
  
  // Initialize app functionality after successful authentication
  initializeAppFunctionality().catch(error => {
    console.error("Failed to initialize app functionality:", error);
    document.getElementById('app').innerHTML = `
      <div class="error-container">
        <h2>Initialization Error</h2>
        <p>Could not initialize the application.</p>
        <p>Error: ${error.message}</p>
        <button onclick="location.reload()">Try Again</button>
      </div>
    `;
  });
}

// Debug function to help troubleshoot token issues
function checkStoredToken() {
  try {
    const storedAuth = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedAuth) {
      const authData = JSON.parse(storedAuth);
      const expiresIn = Math.round((authData.expiresAt - Date.now())/60000);
      console.log("Current stored token:", 
                  "valid:", authData.expiresAt > Date.now(),
                  "expires in:", expiresIn, "minutes",
                  "token:", authData.token?.access_token?.substring(0, 10) + "...");
      return true;
    }
    console.log("No token found in storage");
    return false;
  } catch (e) {
    console.error("Error checking stored token:", e);
    return false;
  }
}

// Check token on page load
window.addEventListener('load', () => {
  setTimeout(checkStoredToken, 1000);
});

// Logout function
function logout() {
  console.log("Logout function called");
  
  // Set the logout flag
  isLoggingOut = true;
  
  // Clear auth token
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  isAuthenticated = false;
  
  // Clear GAPI token
  try {
    if (gapi && gapi.auth) {
      gapi.auth.setToken(null);
      console.log("GAPI token cleared");
    }
  } catch (e) {
    console.error('Error clearing GAPI token:', e);
  }
  
  // Revoke Google Identity token
  try {
    if (google && google.accounts && google.accounts.oauth2) {
      const token = gapi.auth.getToken();
      if (token && token.access_token) {
        fetch(`https://oauth2.googleapis.com/revoke?token=${token.access_token}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
        .then(response => {
          console.log("Token revocation response:", response.status);
        })
        .catch(e => {
          console.error("Error revoking token:", e);
        });
      }
    }
  } catch (e) {
    console.error('Error revoking Google token:', e);
  }
  
  // Show logout message
  const appElement = document.getElementById('app');
  if (appElement) {
    appElement.innerHTML = `
      <div class="logout-message">
        <h2>Logging out...</h2>
        <p>You will be redirected to the login page.</p>
      </div>
    `;
  }
  
  // Reload the page to reset state
  setTimeout(() => {
    window.location.href = window.location.origin + window.location.pathname + "?logout=" + Date.now();
  }, 1000);
}

// Initialize app UI and functionality
function initializeAppFunctionality() {
  return new Promise((resolve, reject) => {
    try {
      console.log("Setting up app functionality");
      
      // Wait to ensure DOM elements are available
      setTimeout(() => {
        try {
          // Get UI elements
          const saveBtn = document.getElementById('save-btn');
          const closeBtn = document.getElementById('close-btn');
          const refreshBtn = document.getElementById('refresh-btn');
          const breadcrumbContainer = document.getElementById('breadcrumb-container');
          const logoutBtn = document.getElementById('logout-btn');
          
          // Add event listeners only if elements exist
          if (saveBtn) saveBtn.addEventListener('click', saveFile);
          if (closeBtn) closeBtn.addEventListener('click', closeDocument);
          if (refreshBtn) refreshBtn.addEventListener('click', refreshFileList);
          if (breadcrumbContainer) breadcrumbContainer.addEventListener('click', handleBreadcrumbClick);
          if (logoutBtn) logoutBtn.addEventListener('click', logout);
          
          // Set up drag-and-drop functionality
          const editorDropzone = document.getElementById('editor-dropzone');
          if (editorDropzone) {
            editorDropzone.addEventListener('dragover', e => {
              e.preventDefault();
              editorDropzone.classList.add('active');
            });
            
            editorDropzone.addEventListener('dragleave', () => {
              editorDropzone.classList.remove('active');
            });
            
            editorDropzone.addEventListener('drop', e => {
              e.preventDefault();
              editorDropzone.classList.remove('active');
              
              const fileId = e.dataTransfer.getData('fileId');
              if (fileId) {
                openFile(fileId);
              }
            });
          }
          
          // Load files from Google Drive
          loadDriveFiles(currentFolderId)
            .then(resolve)
            .catch(reject);
          
        } catch (innerError) {
          console.error("Error in delayed initialization:", innerError);
          reject(innerError);
        }
      }, 500); // Delay to ensure DOM is ready
      
    } catch (error) {
      console.error("Error in app initialization:", error);
      reject(error);
    }
  });
}

// Handle breadcrumb navigation
function handleBreadcrumbClick(event) {
  const target = event.target.closest('.breadcrumb-item');
  if (target && target.dataset.folderId) {
    // Update current folder and trim breadcrumbs
    const folderId = target.dataset.folderId;
    const index = folderBreadcrumbs.findIndex(crumb => crumb.id === folderId);
    
    if (index !== -1) {
      // Trim breadcrumbs to this point
      folderBreadcrumbs = folderBreadcrumbs.slice(0, index + 1);
      currentFolderId = folderId;
      loadDriveFiles(currentFolderId);
    }
  }
}

// Refresh file list
function refreshFileList() {
  // Update the refresh button to show loading state
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  refreshBtn.disabled = true;
  
  // Reload files for current folder
  loadDriveFiles(currentFolderId).finally(() => {
    // Restore refresh button state
    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    refreshBtn.disabled = false;
  });
}

// Render breadcrumb navigation
function renderBreadcrumbs() {
  const breadcrumbContainer = document.getElementById('breadcrumb-container');
  breadcrumbContainer.innerHTML = '';
  
  folderBreadcrumbs.forEach((crumb, index) => {
    const breadcrumbItem = document.createElement('span');
    breadcrumbItem.className = 'breadcrumb-item';
    breadcrumbItem.setAttribute('data-folder-id', crumb.id);
    breadcrumbItem.textContent = crumb.name;
    
    breadcrumbContainer.appendChild(breadcrumbItem);
    
    // Add separator if not the last item
    if (index < folderBreadcrumbs.length - 1) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.innerHTML = '<i class="fas fa-chevron-right"></i>';
      breadcrumbContainer.appendChild(separator);
    }
  });
}

// Load files from Google Drive
async function loadDriveFiles(folderId = 'root') {
  try {
    // Validate token first
    try {
      const token = gapi.auth.getToken();
      if (!token || !token.access_token) {
        console.error("Missing or invalid token when loading files");
        throw new Error("Authentication token is missing. Please log in again.");
      }
      
      // Test token with a simple request
      const testResponse = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: {
          'Authorization': `Bearer ${token.access_token}`
        }
      });
      
      if (!testResponse.ok) {
        console.error("Token validation failed:", testResponse.status);
        if (testResponse.status === 401) {
          // Token is invalid - clear it and show login
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          isAuthenticated = false;
          throw new Error("Your session has expired. Please log in again.");
        }
      }
    } catch (tokenError) {
      console.error("Token validation error:", tokenError);
      // Show login screen
      isAuthenticated = false;
      showLoginPage();
      return;
    }

    // Display loading state
    const fileListElement = document.getElementById('file-list');
    if (fileListElement) {
      fileListElement.innerHTML = '<div class="loading">Loading files...</div>';
    }
    
    // Update breadcrumb navigation
    renderBreadcrumbs();
    
    // Query for files and folders in the current folder
    const folderQuery = folderId === 'root' ? "'root' in parents" : `'${folderId}' in parents`;
    
    console.log(`Fetching files with query: ${folderQuery}`);
    
    try {
      const filesResponse = await gapi.client.drive.files.list({
        'pageSize': 100,
        'fields': 'files(id, name, mimeType, iconLink, parents)',
        'q': `${folderQuery} and trashed=false`,
        'includeItemsFromAllDrives': true,
        'supportsAllDrives': true
      });
      
      if (!filesResponse || !filesResponse.result) {
        throw new Error("Invalid API response structure - missing result object");
      }
      
      const items = filesResponse.result.files || [];
      console.log(`Found ${items.length} items`);
      
      // Separate documents, spreadsheets and folders
      const folders = items.filter(item => item.mimeType === 'application/vnd.google-apps.folder');
      const docs = items.filter(item => item.mimeType === 'application/vnd.google-apps.document');
      const sheets = items.filter(item => item.mimeType === 'application/vnd.google-apps.spreadsheet');
      
      // Sort alphabetically
      folders.sort((a, b) => a.name.localeCompare(b.name));
      docs.sort((a, b) => a.name.localeCompare(b.name));
      sheets.sort((a, b) => a.name.localeCompare(b.name));
      
      renderFiles(folders, docs, sheets);
      
      // Load shared drives if we're at the root level
      if (folderId === 'root') {
        await loadSharedDrives();
      }
    } catch (apiError) {
      console.error("API request failed:", apiError);
      throw new Error(`API request failed: ${apiError.message || 'Unknown API error'}`);
    }
  } catch (error) {
    console.error('Error loading files', error);
    document.getElementById('file-list').innerHTML = `
      <div class="error-message">
        <p>Error loading files.</p>
        <p>Details: ${error.message || 'Unknown error'}</p>
        <button onclick="loadDriveFiles('${folderId}')">Try Again</button>
      </div>
    `;
  }
}

// Load shared drives
async function loadSharedDrives() {
  console.log("Attempting to load shared drives...");
  try {
    const sharedDrivesResponse = await gapi.client.drive.drives.list({
      'pageSize': 50,
      'fields': 'drives(id, name)'
    });
    
    const sharedDrives = sharedDrivesResponse.result.drives || [];
    console.log(`Found ${sharedDrives.length} shared drives`);
    
    // Render shared drives if any
    if (sharedDrives.length > 0) {
      renderSharedDrives(sharedDrives);
    } else {
      console.log("No shared drives found or user doesn't have access to any");
    }
  } catch (error) {
    console.error('Error loading shared drives:', error);
    // Don't show an error to the user as shared drives are optional
  }
}

// Render file lists
function renderFiles(folders, docs, sheets) {
  const fileListElement = document.getElementById('file-list');
  
  // Clear any loading indicators
  if (currentFolderId === 'root') {
    // Only reset the whole list if we're at root
    fileListElement.innerHTML = '';
  } else {
    // Otherwise just clear loading/error messages
    const loadingEl = fileListElement.querySelector('.loading');
    const errorEl = fileListElement.querySelector('.error-message');
    if (loadingEl) loadingEl.remove();
    if (errorEl) errorEl.remove();
  }
  
  // Create section for current folder
  const folderSection = document.createElement('div');
  folderSection.className = 'drive-section current-folder-section';
  
  // Add "Back" option if not at root
  if (currentFolderId !== 'root' && folderBreadcrumbs.length > 1) {
    const backItem = document.createElement('div');
    backItem.className = 'file-item folder-item back-item';
    backItem.innerHTML = `
      <i class="file-icon fas fa-arrow-left"></i>
      <span>Back to ${folderBreadcrumbs[folderBreadcrumbs.length - 2].name}</span>
    `;
    
    backItem.addEventListener('click', () => {
      // Go back to parent folder
      folderBreadcrumbs.pop(); // Remove current folder
      currentFolderId = folderBreadcrumbs[folderBreadcrumbs.length - 1].id;
      loadDriveFiles(currentFolderId);
    });
    
    folderSection.appendChild(backItem);
  }
  
  // Add folders
  if (folders.length > 0) {
    const foldersHeader = document.createElement('p');
    foldersHeader.className = 'section-subheader';
    foldersHeader.innerHTML = '<i class="fas fa-folder"></i> Folders';
    folderSection.appendChild(foldersHeader);
    
    const foldersList = document.createElement('div');
    foldersList.className = 'files-list folders-list';
    
    folders.forEach(folder => {
      const folderItem = createFolderItem(folder);
      foldersList.appendChild(folderItem);
    });
    
    folderSection.appendChild(foldersList);
  }
  
  // Add documents
  if (docs.length > 0) {
    const docsHeader = document.createElement('p');
    docsHeader.className = 'section-subheader';
    docsHeader.innerHTML = '<i class="fas fa-file-alt"></i> Documents';
    folderSection.appendChild(docsHeader);
    
    const docsList = document.createElement('div');
    docsList.className = 'files-list docs-list';
    
    docs.forEach(doc => {
      const docItem = createFileItem(doc, 'doc-item');
      docsList.appendChild(docItem);
    });
    
    folderSection.appendChild(docsList);
  }
  
  // Add spreadsheets
  if (sheets.length > 0) {
    const sheetsHeader = document.createElement('p');
    sheetsHeader.className = 'section-subheader';
    sheetsHeader.innerHTML = '<i class="fas fa-table"></i> Spreadsheets';
    folderSection.appendChild(sheetsHeader);
    
    const sheetsList = document.createElement('div');
    sheetsList.className = 'files-list sheets-list';
    
    sheets.forEach(sheet => {
      const sheetItem = createFileItem(sheet, 'sheet-item');
      sheetsList.appendChild(sheetItem);
    });
    
    folderSection.appendChild(sheetsList);
  }
  
  // Show empty message if no files or folders
  if (folders.length === 0 && docs.length === 0 && sheets.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'No files or folders in this location';
    folderSection.appendChild(emptyMessage);
  }
  
  // Add to file list
  if (currentFolderId === 'root') {
    fileListElement.appendChild(folderSection);
  } else {
    const existingSection = fileListElement.querySelector('.current-folder-section');
    if (existingSection) {
      fileListElement.replaceChild(folderSection, existingSection);
    } else {
      fileListElement.appendChild(folderSection);
    }
  }
}

// Render shared drives
function renderSharedDrives(sharedDrives) {
  const fileListElement = document.getElementById('file-list');
  
  const sharedDrivesSection = document.createElement('div');
  sharedDrivesSection.className = 'drive-section shared-drives-section';
  
  const sharedDrivesHeader = document.createElement('h4');
  sharedDrivesHeader.innerHTML = '<i class="fas fa-users"></i> Shared Drives';
  sharedDrivesSection.appendChild(sharedDrivesHeader);
  
  const drivesList = document.createElement('div');
  drivesList.className = 'files-list drives-list';
  
  sharedDrives.forEach(drive => {
    const driveItem = document.createElement('div');
    driveItem.className = 'file-item shared-drive-item';
    driveItem.setAttribute('data-drive-id', drive.id);
    
    driveItem.innerHTML = `
      <i class="file-icon fas fa-users"></i>
      <span>${drive.name}</span>
    `;
    
    driveItem.addEventListener('click', () => {
      // Navigate to shared drive
      folderBreadcrumbs = [{ id: 'root', name: 'My Drive' }, { id: drive.id, name: drive.name }];
      currentFolderId = drive.id;
      loadDriveFiles(drive.id);
    });
    
    drivesList.appendChild(driveItem);
  });
  
  sharedDrivesSection.appendChild(drivesList);
  
  // Add to file list
  const existingSection = fileListElement.querySelector('.shared-drives-section');
  if (existingSection) {
    fileListElement.replaceChild(sharedDrivesSection, existingSection);
  } else {
    fileListElement.appendChild(sharedDrivesSection);
  }
}

// Create folder item for display
function createFolderItem(folder) {
  const folderItem = document.createElement('div');
  folderItem.className = 'file-item folder-item';
  folderItem.setAttribute('data-folder-id', folder.id);
  
  folderItem.innerHTML = `
    <i class="file-icon fas fa-folder"></i>
    <span>${folder.name}</span>
  `;
  
  // Add click event to navigate into the folder
  folderItem.addEventListener('click', () => {
    folderBreadcrumbs.push({ id: folder.id, name: folder.name });
    currentFolderId = folder.id;
    loadDriveFiles(folder.id);
  });
  
  return folderItem;
}

// Create file item for display
function createFileItem(file, itemClass) {
  const fileItem = document.createElement('div');
  fileItem.className = `file-item ${itemClass}`;
  fileItem.setAttribute('draggable', 'true');
  fileItem.setAttribute('data-file-id', file.id);
  
  // Choose icon based on file type
  let icon = 'fa-file-alt';
  if (itemClass === 'sheet-item') {
    icon = 'fa-table';
  }
  
  fileItem.innerHTML = `
    <i class="file-icon fas ${icon}"></i>
    <span>${file.name}</span>
  `;
  
  // Add click event to open the file
  fileItem.addEventListener('click', () => {
    openFile(file.id, file.mimeType);
  });
  
  // Add drag events
  fileItem.addEventListener('dragstart', e => {
    e.dataTransfer.setData('fileId', file.id);
    e.dataTransfer.setData('fileMimeType', file.mimeType);
    fileItem.classList.add('dragging');
  });
  
  fileItem.addEventListener('dragend', () => {
    fileItem.classList.remove('dragging');
  });
  
  return fileItem;
}

// Open a file for editing
async function openFile(fileId, mimeType) {
  try {
    // Get file metadata
    const metadataResponse = await gapi.client.drive.files.get({
      fileId: fileId,
      fields: 'name,id,mimeType',
      supportsAllDrives: true
    });
    
    const file = metadataResponse.result;
    mimeType = file.mimeType; // Use the mime type from metadata
    
    // Update UI
    currentFile = file;
    document.getElementById('current-file-name').textContent = file.name;
    document.getElementById('save-btn').disabled = true; // Disable until loaded
    document.getElementById('close-btn').disabled = false;
    
    // Hide dropzone and show editor
    document.getElementById('editor-dropzone').style.display = 'none';
    const editorContainer = document.getElementById('editor-container');
    editorContainer.style.display = 'block';
    editorContainer.innerHTML = '<div class="loading">Loading document...</div>';
    
    try {
      // Open based on file type
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        await openSpreadsheet(fileId, editorContainer);
      } else if (mimeType === 'application/vnd.google-apps.document') {
        await openDocument(fileId, editorContainer);
      } else {
        throw new Error(`Unsupported file type: ${mimeType}`);
      }
      
      // Mark selected file in list
      const fileItems = document.querySelectorAll('.file-item');
      fileItems.forEach(item => {
        if (item.getAttribute('data-file-id') === fileId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
      
    } catch (contentError) {
      console.error('Error loading file content', contentError);
      editorContainer.innerHTML = `
        <div class="error-message">
          <p>Error loading content.</p>
          <p>Details: ${contentError.message || 'Unknown error'}</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error opening file', error);
    alert('Error opening file: ' + error.message);
  }
}

// Open a Google Doc
async function openDocument(fileId, editorContainer) {
  // Get file content as HTML
  const contentResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/html&alt=media&key=${GOOGLE_API_KEY}`,
    {
      headers: {
        'Authorization': `Bearer ${gapi.auth.getToken().access_token}`,
        'Accept': 'text/html'
      }
    }
  );
  
  if (!contentResponse.ok) {
    throw new Error(`HTTP error! status: ${contentResponse.status}`);
  }
  
  const htmlContent = await contentResponse.text();
  
  // Create an iframe for the document
  editorContainer.style.position = 'relative';
  editorContainer.style.height = '100%';
  
  editorContainer.innerHTML = `
    <iframe id="editor" style="border: none; width: 100%; height: 100%; position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></iframe>
  `;
  
  const editorIframe = document.getElementById('editor');
  
  // Set iframe content
  editorIframe.onload = () => {
    const iframeDoc = editorIframe.contentDocument || editorIframe.contentWindow.document;
    
    // Add custom styles to improve appearance
    const styleElement = iframeDoc.createElement('style');
    styleElement.textContent = `
      html, body {
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: auto;
        width: 100%;
      }
      body {
        font-family: Arial, sans-serif;
        padding: 20px;
        line-height: 1.5;
        color: #333;
        min-height: 100%;
        box-sizing: border-box;
        max-width: 100%;
        overflow-x: hidden;
      }
      /* Fix Google Docs page layout */
      .kix-appview-editor, .docs-ui-unprintable, .kix-page {
        width: 100% !important;
        max-width: 100% !important;
      }
      /* Remove Google Docs page width restrictions */
      .kix-page-paginated {
        width: auto !important;
        margin: 0 !important;
        box-shadow: none !important;
        border: none !important;
      }
      /* Remove any vertical dividers or borders */
      div[style*="border-right"], 
      div[style*="border-left"],
      div[style*="vertical-align"],
      .kix-page-column-border {
        border: none !important;
        background: none !important;
      }
      /* Fix Google Docs specific column issues */
      .kix-page-column {
        width: 100% !important;
        border: none !important;
        max-width: 100% !important;
      }
      /* Remove any absolute positioning that might cause layout issues */
      [style*="position: absolute"] {
        position: static !important;
      }
      /* Override inline styles for the main content area */
      [role="presentation"] {
        width: 100% !important;
        max-width: 100% !important;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      td, th {
        border: 1px solid #ddd;
        padding: 8px;
      }
      :focus {
        outline: 1px solid #4285f4;
      }
    `;
    
    iframeDoc.head.appendChild(styleElement);
    
    // Clean up HTML structure
    const cleanUpDoc = () => {
      // Remove vertical dividers
      const dividers = iframeDoc.querySelectorAll('div[style*="width: 1px"], div[style*="border-right"], .kix-page-column-border');
      dividers.forEach(el => el.remove());
      
      // Fix column layouts
      const columns = iframeDoc.querySelectorAll('.kix-page-column');
      columns.forEach(col => {
        col.style.width = '100%';
        col.style.maxWidth = '100%';
        col.style.border = 'none';
      });

      // Force main content area width
      const contentDivs = iframeDoc.querySelectorAll('.kix-page, .kix-page-content-wrapper');
      contentDivs.forEach(div => {
        div.style.width = '100%';
        div.style.maxWidth = '100%';
        div.style.margin = '0';
        div.style.padding = '0';
      });

      // Override inline width styles
      const allElements = iframeDoc.querySelectorAll('*[style*="width"]');
      allElements.forEach(el => {
        // Don't change widths for small elements
        if (!el.classList.contains('kix-lineview-text-block') && 
            !el.classList.contains('kix-selection-overlay')) {
          el.style.width = '100%';
          el.style.maxWidth = '100%';
        }
      });
    };
    
    // Clean up the document
    cleanUpDoc();
    // Run again after a delay for dynamic content
    setTimeout(cleanUpDoc, 100);
    
    // Make it editable
    iframeDoc.body.contentEditable = 'true';
    iframeDoc.designMode = 'on';
    
    // Track content changes
    const observer = new MutationObserver(() => {
      editorContent = iframeDoc.documentElement.outerHTML;
    });
    
    observer.observe(iframeDoc.body, { 
      subtree: true, 
      childList: true,
      attributes: true, 
      characterData: true 
    });
    
    // Enable save button
    document.getElementById('save-btn').disabled = false;
  };
  
  // Load document into iframe
  const iframeDoc = editorIframe.contentDocument || 
                  (editorIframe.contentWindow && editorIframe.contentWindow.document);
  
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();
  } else {
    editorIframe.srcdoc = htmlContent;
  }
}

// Open a Google Sheet
async function openSpreadsheet(fileId, editorContainer) {
  try {
    // Check if sheets API is available
    if (!gapi.client.sheets) {
      console.error("Sheets API not initialized");
      await loadSheetsAPI();
      if (!gapi.client.sheets) {
        throw new Error("Could not load Sheets API. Please refresh and try again.");
      }
    }
    
    console.log("Attempting to open spreadsheet:", fileId);
    
    // Try to access with token directly
    try {
      const token = gapi.auth.getToken().access_token;
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?includeGridData=true`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      if (!response.ok) {
        console.error("Fetch API error:", response.status, await response.text());
        throw new Error("Error accessing spreadsheet with direct token");
      }
      
      const spreadsheet = await response.json();
      renderSpreadsheet(spreadsheet, editorContainer);
      
    } catch (fetchError) {
      console.error("Fetch method failed:", fetchError);
      
      // Fall back to gapi client
      try {
        console.log("Trying with gapi client instead...");
        const response = await gapi.client.sheets.spreadsheets.get({
          spreadsheetId: fileId,
          includeGridData: true
        });
        
        renderSpreadsheet(response.result, editorContainer);
      } catch (gapiError) {
        console.error("GAPI method also failed:", gapiError);
        throw new Error("Could not access spreadsheet. Verify you have permissions to edit this file.");
      }
    }
  } catch (error) {
    console.error('Error loading spreadsheet:', error);
    throw new Error(`Failed to load spreadsheet: ${error.message}`);
  }
}

// Render spreadsheet in the editor
function renderSpreadsheet(spreadsheet, editorContainer) {
  // Create HTML table of the spreadsheet
  let tableHTML = '<table class="sheets-table">';
  
  // Get the first sheet
  const sheet = spreadsheet.sheets[0];
  if (!sheet || !sheet.data || !sheet.data[0]) {
    throw new Error("Spreadsheet data is incomplete or in unexpected format");
  }
  
  const data = sheet.data[0];
  const rowCount = data.rowData ? data.rowData.length : 0;
  
  // Handle empty spreadsheet
  const emptyGrid = rowCount === 0;
  const displayRowCount = emptyGrid ? 10 : rowCount;
  
  // Determine max column count
  let maxCols = 0;
  if (data.rowData) {
    for (let i = 0; i < rowCount; i++) {
      const rowData = data.rowData[i];
      if (rowData && rowData.values) {
        maxCols = Math.max(maxCols, rowData.values.length);
      }
    }
  }
  maxCols = Math.max(maxCols, 10);
  
  // Generate column headers (A, B, C, etc.)
  tableHTML += '<tr><th></th>';
  for (let col = 0; col < maxCols; col++) {
    const colLetter = String.fromCharCode(65 + col); // A=65, B=66, etc.
    tableHTML += `<th>${colLetter}</th>`;
  }
  tableHTML += '</tr>';
  
  // Generate rows with row numbers
  for (let row = 0; row < displayRowCount; row++) {
    tableHTML += `<tr><th>${row + 1}</th>`;
    
    if (!emptyGrid && data.rowData && data.rowData[row] && data.rowData[row].values) {
      const rowData = data.rowData[row];
      for (let col = 0; col < maxCols; col++) {
        const cell = col < rowData.values.length ? rowData.values[col] : {};
        const value = cell.formattedValue || '';
        tableHTML += `<td contenteditable="true" data-row="${row}" data-col="${col}">${value}</td>`;
      }
    } else {
      // Empty row
      for (let col = 0; col < maxCols; col++) {
        tableHTML += `<td contenteditable="true" data-row="${row}" data-col="${col}"></td>`;
      }
    }
    
    tableHTML += '</tr>';
  }
  
  tableHTML += '</table>';
  
  // Create sheet editor UI
  editorContainer.innerHTML = `
    <div id="sheets-editor">
      <div class="sheets-toolbar">
        <span>Sheet: ${sheet.properties.title || "Sheet1"}</span>
      </div>
      <div class="sheets-content">
        ${tableHTML}
      </div>
    </div>
  `;
  
  // Track cell changes
  const cells = editorContainer.querySelectorAll('td[contenteditable="true"]');
  cells.forEach(cell => {
    cell.addEventListener('input', () => {
      const row = parseInt(cell.dataset.row);
      const col = parseInt(cell.dataset.col);
      const value = cell.textContent;
      
      // Store updated cell value
      if (!editorContent) editorContent = {};
      if (!editorContent.updates) editorContent.updates = [];
      
      // Check for existing update for this cell
      const existingUpdate = editorContent.updates.find(
        update => update.row === row && update.col === col
      );
      
      if (existingUpdate) {
        existingUpdate.value = value;
      } else {
        editorContent.updates.push({ row, col, value });
      }
    });
  });
  
  // Store spreadsheet data for saving
  editorContent = {
    spreadsheetId: spreadsheet.spreadsheetId,
    sheetId: sheet.properties.sheetId,
    updates: []
  };
  
  // Enable save button
  document.getElementById('save-btn').disabled = false;
}

// Close the current document
function closeDocument() {
  // Reset current file
  currentFile = null;
  editorContent = '';
  
  // Update UI
  document.getElementById('current-file-name').textContent = 'No file selected';
  document.getElementById('save-btn').disabled = true;
  document.getElementById('close-btn').disabled = true;
  
  // Show dropzone and hide editor
  document.getElementById('editor-dropzone').style.display = 'block';
  document.getElementById('editor-container').style.display = 'none';
  
  // Clear active file in list
  const fileItems = document.querySelectorAll('.file-item');
  fileItems.forEach(item => {
    item.classList.remove('active');
  });
}

// Save the current file
async function saveFile() {
  if (!currentFile) return;
  
  try {
    const saveButton = document.getElementById('save-btn');
    saveButton.textContent = 'Saving...';
    saveButton.disabled = true;
    
    if (currentFile.mimeType === 'application/vnd.google-apps.spreadsheet') {
      await saveSpreadsheet();
    } else {
      await saveDocument();
    }
    
    saveButton.textContent = 'Save';
    saveButton.disabled = false;
    alert('File saved successfully!');
  } catch (error) {
    console.error('Error saving file', error);
    document.getElementById('save-btn').textContent = 'Save';
    document.getElementById('save-btn').disabled = false;
    alert('Error saving file: ' + error.message);
  }
}

// Save document changes
async function saveDocument() {
  const editorIframe = document.getElementById('editor');
  const iframeDoc = editorIframe.contentDocument || editorIframe.contentWindow.document;
  const contentToSave = iframeDoc.documentElement.outerHTML;
  
  // Create a blob with the HTML content
  const blob = new Blob([contentToSave], { type: 'text/html' });
  
  // Create form data for multipart request
  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify({
    name: currentFile.name,
    mimeType: 'application/vnd.google-apps.document'
  })], { type: 'application/json' }));
  formData.append('file', blob);
  
  // Use fetch API for multipart upload
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${currentFile.id}?uploadType=multipart&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${gapi.auth.getToken().access_token}`
      },
      body: formData
    }
  );
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error.message || 'Unknown error during save');
  }
}

// Save spreadsheet changes
async function saveSpreadsheet() {
  // Check if sheets API is available
  if (!gapi.client.sheets) {
    console.error("Sheets API not available when trying to save");
    await loadSheetsAPI();
    if (!gapi.client.sheets) {
      throw new Error("Could not load Sheets API for saving. Please refresh and try again.");
    }
  }

  if (!editorContent || !editorContent.updates || editorContent.updates.length === 0) {
    console.log("No changes to save");
    return;
  }
  
  console.log(`Saving ${editorContent.updates.length} cell updates to spreadsheet ${editorContent.spreadsheetId}`);
  
  try {
    // Prepare batch update request
    const requests = editorContent.updates.map(update => {
      // Determine value type
      let userEnteredValue = {};
      const value = update.value.trim();
      
      // Check if number
      if (!isNaN(value) && value !== '') {
        userEnteredValue = { numberValue: parseFloat(value) };
      } 
      // Check if boolean
      else if (value.toLowerCase() === 'true') {
        userEnteredValue = { boolValue: true };
      }
      else if (value.toLowerCase() === 'false') {
        userEnteredValue = { boolValue: false };
      }
      // Otherwise string
      else {
        userEnteredValue = { stringValue: value };
      }
      
      return {
        updateCells: {
          rows: [
            {
              values: [
                {
                  userEnteredValue: userEnteredValue
                }
              ]
            }
          ],
          fields: 'userEnteredValue',
          range: {
            sheetId: editorContent.sheetId,
            startRowIndex: update.row,
            endRowIndex: update.row + 1,
            startColumnIndex: update.col,
            endColumnIndex: update.col + 1
          }
        }
      };
    });
    
    // Try GAPI first
    try {
      const response = await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: editorContent.spreadsheetId,
        resource: { requests }
      });
      
      console.log("Spreadsheet save successful:", response);
      editorContent.updates = [];
    } catch (gapiError) {
      console.error("Error with GAPI method:", gapiError);
      
      // Fall back to fetch API
      const token = gapi.auth.getToken().access_token;
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${editorContent.spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: requests
          })
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP error ${response.status}: ${errorText}`);
        throw new Error(`Error saving: ${response.status} - ${errorText}`);
      }
      
      console.log("Fetch API save method succeeded");
      editorContent.updates = [];
    }
  } catch (error) {
    console.error("All save methods failed:", error);
    throw new Error("Could not save spreadsheet changes. Please verify your permissions or try again later.");
  }
}