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
                 'https://www.googleapis.com/auth/spreadsheets ' +
                 'https://www.googleapis.com/auth/spreadsheets.readonly';
                 
// Global variables
let currentFile = null;
let editorContent = '';
let isAuthenticated = false;
let tokenClient;
let currentFolderId = 'root'; // Start at root folder
let folderBreadcrumbs = [{ id: 'root', name: 'My Drive' }]; // Track folder navigation

function initializeApp() {
  console.log('Initializing app with API key:', GOOGLE_API_KEY?.substring(0, 5) + '...');
  
  // Load the auth2 library first
  gapi.load('client:auth2', {
    callback: function() {
      console.log('GAPI client loaded');
      initGapiClient();
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
  
  // Initialize Google Identity Services
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: API_SCOPE,
    callback: handleAuthResponse,
  });
  
  // Add event listener for login button
  document.getElementById('login-btn').addEventListener('click', handleAuthClick);
}

async function initGapiClient() {
  console.log('Initializing GAPI client');
  
  // First, check if the API key is available
  if (!GOOGLE_API_KEY) {
    console.error('GOOGLE_API_KEY is missing or undefined');
    document.querySelector('#app').innerHTML = '<div class="error-container"><h2>Configuration Error</h2><p>API Key is missing.</p></div>';
    return;
  }
  
  try {
    // First initialize with just the Drive API
    await gapi.client.init({
      apiKey: GOOGLE_API_KEY,
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    });
    
    console.log("Drive API initialized successfully");
    
    // Then load the Sheets API separately to ensure proper loading
    await loadSheetsAPI();
    
    console.log("GAPI client fully initialized");
  } catch (error) {
    console.error("Error initializing GAPI client:", error);
    document.querySelector('#app').innerHTML = `
      <div class="error-container">
        <h2>API Error</h2>
        <p>Failed to initialize Google API client.</p>
        <p>Error details: ${error.message || JSON.stringify(error)}</p>
        <p>Please check your API key and make sure the Drive API is enabled in your Google Cloud project.</p>
      </div>
    `;
  }
}

async function loadSheetsAPI() {
  try {
    await gapi.client.load('sheets', 'v4');
    console.log("Sheets API loaded successfully");
    console.log("Available APIs:", Object.keys(gapi.client));
  } catch (error) {
    console.error("Error loading Sheets API:", error);
  }
}

function handleAuthClick() {
  if (!isAuthenticated) {
    tokenClient.requestAccessToken();
  }
}

function handleAuthResponse(response) {
  if (response.error !== undefined) {
    console.error('Auth error:', response);
    return;
  }
  
  isAuthenticated = true;
  
  // Replace login content with the app template
  const appTemplate = document.getElementById('app-template');
  document.getElementById('app').innerHTML = appTemplate.innerHTML;
  
  // Initialize app functionality after successful authentication
  initializeAppFunctionality();
}

function initializeAppFunctionality() {
  // Add event listeners
  document.getElementById('save-btn').addEventListener('click', saveFile);
  document.getElementById('close-btn').addEventListener('click', closeDocument);
  document.getElementById('refresh-btn').addEventListener('click', refreshFileList);
  
  // Set up drop zone behavior for the editor
  const editorDropzone = document.getElementById('editor-dropzone');
  
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
  
  // Set up breadcrumb container event handlers
  document.getElementById('breadcrumb-container').addEventListener('click', handleBreadcrumbClick);
  
  // Load files from Google Drive
  loadDriveFiles(currentFolderId);
}

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

async function loadDriveFiles(folderId = 'root') {
  try {
    // Display loading state
    document.getElementById('file-list').innerHTML = '<div class="loading">Loading files...</div>';
    
    // Update the breadcrumb navigation
    renderBreadcrumbs();
    
    // Query for files and folders in the current folder
    const folderQuery = folderId === 'root' ? "'root' in parents" : `'${folderId}' in parents`;
    
    const filesResponse = await gapi.client.drive.files.list({
      'pageSize': 100,
      'fields': 'files(id, name, mimeType, iconLink, parents)',
      'q': `${folderQuery} and trashed=false`,
      'includeItemsFromAllDrives': true,
      'supportsAllDrives': true
    });
    
    const items = filesResponse.result.files || [];
    
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
  } catch (error) {
    console.error('Error loading files', error);
    document.getElementById('file-list').innerHTML = `
      <div class="error-message">
        <p>Error loading files.</p>
        <p>Details: ${error.message || 'Unknown error'}</p>
      </div>
    `;
  }
}

async function loadSharedDrives() {
  try {
    const sharedDrivesResponse = await gapi.client.drive.drives.list({
      'pageSize': 50,
      'fields': 'drives(id, name)'
    });
    
    const sharedDrives = sharedDrivesResponse.result.drives || [];
    
    // Render shared drives if any
    if (sharedDrives.length > 0) {
      renderSharedDrives(sharedDrives);
    }
  } catch (error) {
    console.error('Error loading shared drives', error);
  }
}

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
  
  // If we're not at root, add "Back" option at the top
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
  
  // If no files or folders in current directory
  if (folders.length === 0 && docs.length === 0 && sheets.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'No files or folders in this location';
    folderSection.appendChild(emptyMessage);
  }
  
  // If we're at root, append to the file list directly
  // Otherwise replace the current folder section if it exists
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
      // When clicked, load contents of this shared drive
      // We'll consider shared drives as a separate branch in our navigation
      folderBreadcrumbs = [{ id: 'root', name: 'My Drive' }, { id: drive.id, name: drive.name }];
      currentFolderId = drive.id;
      loadDriveFiles(drive.id);
    });
    
    drivesList.appendChild(driveItem);
  });
  
  sharedDrivesSection.appendChild(drivesList);
  
  // Add to file list element
  const existingSection = fileListElement.querySelector('.shared-drives-section');
  if (existingSection) {
    fileListElement.replaceChild(sharedDrivesSection, existingSection);
  } else {
    fileListElement.appendChild(sharedDrivesSection);
  }
}

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
    // Navigate into this folder
    folderBreadcrumbs.push({ id: folder.id, name: folder.name });
    currentFolderId = folder.id;
    loadDriveFiles(folder.id);
  });
  
  return folderItem;
}

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

async function openFile(fileId, mimeType) {
  try {
    // Get the file metadata
    const metadataResponse = await gapi.client.drive.files.get({
      fileId: fileId,
      fields: 'name,id,mimeType',
      supportsAllDrives: true
    });
    
    const file = metadataResponse.result;
    mimeType = file.mimeType; // Use the mime type from metadata to be sure
    
    // Update UI first to show loading
    currentFile = file;
    document.getElementById('current-file-name').textContent = file.name;
    document.getElementById('save-btn').disabled = true; // Disable until loaded
    document.getElementById('close-btn').disabled = false; // Enable close button immediately
    
    // Hide the dropzone and show the editor with loading message
    document.getElementById('editor-dropzone').style.display = 'none';
    const editorContainer = document.getElementById('editor-container');
    editorContainer.style.display = 'block';
    editorContainer.innerHTML = '<div class="loading">Loading document...</div>';
    
    try {
      // Handle different file types
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        await openSpreadsheet(fileId, editorContainer);
      } else if (mimeType === 'application/vnd.google-apps.document') {
        await openDocument(fileId, editorContainer);
      } else {
        throw new Error(`Unsupported file type: ${mimeType}`);
      }
      
      // Mark the selected file in the file list
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

async function openDocument(fileId, editorContainer) {
  // Get the file content as HTML
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
  
  // Create an iframe to display the document with improved styling for full space
  editorContainer.style.position = 'relative';  // Make sure the container is positioned
  editorContainer.style.height = '100%';        // Ensure container takes full height
  
  editorContainer.innerHTML = `
    <iframe id="editor" style="border: none; width: 100%; height: 100%; position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></iframe>
  `;
  
  const editorIframe = document.getElementById('editor');
  
  // Set the content of the iframe
  const iframeDoc = editorIframe.contentDocument || 
                   (editorIframe.contentWindow && editorIframe.contentWindow.document);
  
  editorIframe.onload = () => {
    const iframeDoc = editorIframe.contentDocument || editorIframe.contentWindow.document;
    
    // Add base styles to make the content look better and fill available space
    const styleElement = iframeDoc.createElement('style');
    styleElement.textContent = `
      html, body {
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: auto;
      }
      body {
        font-family: Arial, sans-serif;
        padding: 20px;
        line-height: 1.5;
        color: #333;
        min-height: 100%;
        box-sizing: border-box;
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
    
    // Make it editable
    iframeDoc.body.contentEditable = 'true';
    iframeDoc.designMode = 'on';
    
    // Store the content for saving later
    const observer = new MutationObserver(() => {
      editorContent = iframeDoc.documentElement.outerHTML;
    });
    
    observer.observe(iframeDoc.body, { 
      subtree: true, 
      childList: true,
      attributes: true, 
      characterData: true 
    });
    
    // Enable the save button
    document.getElementById('save-btn').disabled = false;
  };
  
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();
  } else {
    // If direct access to iframe document is not working, set it on load
    editorIframe.srcdoc = htmlContent;
  }
}

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
    
    // First try to access with token directly
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
      
      // Fall back to gapi client if fetch fails
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

function renderSpreadsheet(spreadsheet, editorContainer) {
  // Create a simple HTML table representation of the spreadsheet
  let tableHTML = '<table class="sheets-table">';
  
  // Get the first sheet
  const sheet = spreadsheet.sheets[0];
  if (!sheet || !sheet.data || !sheet.data[0]) {
    throw new Error("Spreadsheet data is incomplete or in unexpected format");
  }
  
  const data = sheet.data[0];
  const rowCount = data.rowData ? data.rowData.length : 0;
  
  // Set a reasonable default if no data (create empty 10x10 grid)
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
  // Ensure we have at least some columns if spreadsheet is empty
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
  
  // Create custom sheet editor
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
  
  // Add event listeners to track changes
  const cells = editorContainer.querySelectorAll('td[contenteditable="true"]');
  cells.forEach(cell => {
    cell.addEventListener('input', () => {
      const row = parseInt(cell.dataset.row);
      const col = parseInt(cell.dataset.col);
      const value = cell.textContent;
      
      // Store the updated cell value
      // This will be used when saving
      if (!editorContent) editorContent = {};
      if (!editorContent.updates) editorContent.updates = [];
      
      // Check if we already have an update for this cell
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
  
  // Store spreadsheet ID and sheet ID for saving
  editorContent = {
    spreadsheetId: spreadsheet.spreadsheetId,
    sheetId: sheet.properties.sheetId,
    updates: []
  };
  
  // Enable the save button
  document.getElementById('save-btn').disabled = false;
}

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

async function saveDocument() {
  const editorIframe = document.getElementById('editor');
  const iframeDoc = editorIframe.contentDocument || editorIframe.contentWindow.document;
  const contentToSave = iframeDoc.documentElement.outerHTML;
  
  // Create a blob with the HTML content
  const blob = new Blob([contentToSave], { type: 'text/html' });
  
  // Create form data for the multipart request
  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify({
    name: currentFile.name,
    mimeType: 'application/vnd.google-apps.document'
  })], { type: 'application/json' }));
  formData.append('file', blob);
  
  // Use fetch API for the multipart upload
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
    // Prepare batch update request with proper value detection
    const requests = editorContent.updates.map(update => {
      // Determine value type (string, number, boolean, etc.)
      let userEnteredValue = {};
      const value = update.value.trim();
      
      // Check if it's a number
      if (!isNaN(value) && value !== '') {
        userEnteredValue = { numberValue: parseFloat(value) };
      } 
      // Check if it's a boolean
      else if (value.toLowerCase() === 'true') {
        userEnteredValue = { boolValue: true };
      }
      else if (value.toLowerCase() === 'false') {
        userEnteredValue = { boolValue: false };
      }
      // Otherwise treat as string
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
      
      // Try the fetch API approach
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