// Import Firebase modules from CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Import configuration
import { firebaseConfig, SECRET_KEY } from './config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM elements
const loginContainer = document.getElementById('loginContainer');
const mainContainer = document.getElementById('mainContainer');
const loginForm = document.getElementById('loginForm');
const ucIdInput = document.getElementById('ucIdInput');
const passwordInput = document.getElementById('passwordInput');
const loginError = document.getElementById('loginError');
const userInfo = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');

const statusEl = document.getElementById('status');
const collectionSelect = document.getElementById('collectionSelect');
const dataDisplay = document.getElementById('dataDisplay');
const refreshBtn = document.getElementById('refreshBtn');

// Collections for attendance system
const commonCollections = [
    'users',
    'attendance',
    'classes',
    'courses',
    'records',
    'sessions'
];

// Store discovered collections and current user
let discoveredCollections = new Set();
let currentUser = null;

// Hash password using SHA-256 (matching your AuthService)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + SECRET_KEY);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Generate token for session
function generateToken(ucId) {
    const tokenData = `${ucId}_${Date.now()}_${Math.random()}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(tokenData + SECRET_KEY);
    return Array.from(new Uint8Array(data))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 64);
}

// Save session to localStorage
function saveSession(user) {
    const token = generateToken(user.ucId);
    localStorage.setItem('attendance_user', JSON.stringify(user));
    localStorage.setItem('attendance_token', token);
}

// Check for existing session on page load
async function checkExistingSession() {
    const userStr = localStorage.getItem('attendance_user');
    const token = localStorage.getItem('attendance_token');
    
    if (userStr && token) {
        try {
            const user = JSON.parse(userStr);
            
            // Verify user still exists and is active
            await signInAnonymously(auth);
            const userQuery = query(collection(db, 'users'), where('ucId', '==', user.ucId));
            const snapshot = await getDocs(userQuery);
            
            if (!snapshot.empty) {
                const userData = snapshot.docs[0].data();
                if (userData.isActive) {
                    currentUser = { id: snapshot.docs[0].id, ...userData };
                    showMainInterface();
                    return true;
                }
            }
            
            // Session invalid, clear it
            localStorage.clear();
        } catch (error) {
            console.error('Session check error:', error);
            localStorage.clear();
        }
    }
    return false;
}

// Login functionality
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    
    const ucId = ucIdInput.value.trim();
    const password = passwordInput.value;
    
    if (!ucId || !password) {
        loginError.textContent = 'Please enter both UC ID and password';
        return;
    }
    
    try {
        loginError.textContent = 'Logging in...';
        
        // Sign in anonymously to Firebase
        await signInAnonymously(auth);
        
        // Query users collection
        const usersQuery = query(collection(db, 'users'), where('ucId', '==', ucId));
        const snapshot = await getDocs(usersQuery);
        
        if (snapshot.empty) {
            loginError.textContent = 'Invalid UC ID or password';
            return;
        }
        
        const userDoc = snapshot.docs[0];
        const userData = { id: userDoc.id, ...userDoc.data() };
        
        // Check if user is active
        if (!userData.isActive) {
            loginError.textContent = 'Account is deactivated';
            return;
        }
        
        // Verify password
        const passwordHash = await hashPassword(password);
        if (userData.passwordHash !== passwordHash) {
            loginError.textContent = 'Invalid UC ID or password';
            return;
        }
        
        // Login successful - save session
        currentUser = userData;
        saveSession(currentUser);
        showMainInterface();
        
    } catch (error) {
        console.error('Login error:', error);
        loginError.textContent = 'Login failed: ' + error.message;
    }
});

// Logout functionality
logoutBtn.addEventListener('click', () => {
    currentUser = null;
    localStorage.clear();
    loginContainer.style.display = 'flex';
    mainContainer.style.display = 'none';
    ucIdInput.value = '';
    passwordInput.value = '';
    loginError.textContent = '';
});

// Show main interface after login
function showMainInterface() {
    loginContainer.style.display = 'none';
    mainContainer.style.display = 'block';
    
    // Display user info
    const roleEmoji = currentUser.role === 'admin' ? '👑' : currentUser.role === 'moderator' ? '🛡️' : '👤';
    userInfo.innerHTML = `
        <span>${roleEmoji} ${currentUser.firstName} ${currentUser.lastName}</span>
        <span class="user-role-badge ${currentUser.role || 'student'}">${(currentUser.role || 'student').toUpperCase()}</span>
    `;
    
    // Show navigation links based on role
    const navigationLinks = document.getElementById('navigationLinks');
    const adminPanelLink = document.getElementById('adminPanelLink');
    const createAccountLink = document.getElementById('createAccountLink');
    
    if (currentUser.role === 'admin' || currentUser.role === 'moderator') {
        navigationLinks.style.display = 'flex';
        
        if (currentUser.role === 'admin') {
            adminPanelLink.style.display = 'inline-block';
            createAccountLink.style.display = 'inline-block';
        }
    }
    
    // Initialize the data viewer
    initialize();
}

// Initialize the app
async function initialize() {
    try {
        updateStatus('✅ Connected to Firebase', 'connected');
        
        // Populate collection dropdown
        populateCollections();
        
        // Discover existing collections
        await discoverCollections();
        
    } catch (error) {
        console.error('Error initializing:', error);
        updateStatus('❌ Error connecting to Firebase: ' + error.message, 'error');
    }
}

// Update status message
function updateStatus(message, className = 'loading') {
    statusEl.innerHTML = `<span class="${className}">${message}</span>`;
}

// Discover collections by trying to fetch from common names
async function discoverCollections() {
    updateStatus('🔍 Discovering collections...', 'loading');
    
    const collectionsToTry = [
        ...commonCollections,
        'admins',
        'moderators',
        'students',
        'teachers',
        'events',
        'schedules',
        'departments',
        'subjects',
        'logs',
        'notifications',
        'settings'
    ];
    
    const foundCollections = [];
    
    for (const collectionName of collectionsToTry) {
        try {
            const querySnapshot = await getDocs(collection(db, collectionName));
            if (!querySnapshot.empty) {
                foundCollections.push(collectionName);
                discoveredCollections.add(collectionName);
            }
        } catch (error) {
            // Collection doesn't exist or no permission, skip it
        }
    }
    
    if (foundCollections.length > 0) {
        updateStatus(`✅ Connected to Firebase - Found ${foundCollections.length} collection(s)`, 'connected');
        populateCollections();
    } else {
        updateStatus('✅ Connected to Firebase', 'connected');
    }
}

// Populate collections dropdown
function populateCollections() {
    // Clear existing options except the first one
    collectionSelect.innerHTML = '<option value="">-- Choose a collection --</option>';
    
    // Combine common collections and discovered collections
    const allCollections = [...new Set([...commonCollections, ...discoveredCollections])];
    allCollections.sort();
    
    // Add all collections
    allCollections.forEach(collectionName => {
        const option = document.createElement('option');
        option.value = collectionName;
        const isDiscovered = discoveredCollections.has(collectionName);
        option.textContent = collectionName.charAt(0).toUpperCase() + collectionName.slice(1) + (isDiscovered ? ' ✓' : '');
        collectionSelect.appendChild(option);
    });
    
    // Add custom option
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = '➕ Enter custom collection name...';
    collectionSelect.appendChild(customOption);
}

// Add role filter for users
function addUserFilters() {
    const controlsDiv = document.querySelector('.controls');
    
    // Check if filters already exist
    if (document.querySelector('.filter-group')) return;
    
    const filterGroup = document.createElement('div');
    filterGroup.className = 'filter-group';
    filterGroup.innerHTML = `
        <label for="roleFilter">Filter by Role:</label>
        <select id="roleFilter">
            <option value="">All Roles</option>
            <option value="student">Students</option>
            <option value="moderator">Moderators</option>
            <option value="admin">Admins</option>
        </select>
        
        <label for="statusFilter">Status:</label>
        <select id="statusFilter">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
        </select>
    `;
    
    controlsDiv.appendChild(filterGroup);
    
    // Add event listeners
    document.getElementById('roleFilter').addEventListener('change', filterUsers);
    document.getElementById('statusFilter').addEventListener('change', filterUsers);
}

let allUsersData = [];

function filterUsers() {
    if (collectionSelect.value !== 'users') return;
    
    const roleFilter = document.getElementById('roleFilter')?.value;
    const statusFilter = document.getElementById('statusFilter')?.value;
    
    let filteredData = [...allUsersData];
    
    if (roleFilter) {
        filteredData = filteredData.filter(user => user.role === roleFilter);
    }
    
    if (statusFilter === 'active') {
        filteredData = filteredData.filter(user => user.isActive === true);
    } else if (statusFilter === 'inactive') {
        filteredData = filteredData.filter(user => user.isActive === false);
    }
    
    displayData('users', filteredData);
}

// Fetch and display data from selected collection
async function fetchCollectionData(collectionName) {
    if (!collectionName) {
        dataDisplay.innerHTML = '<p class="info">Select a collection to view data</p>';
        // Remove filters if they exist
        const filterGroup = document.querySelector('.filter-group');
        if (filterGroup) filterGroup.remove();
        return;
    }
    
    dataDisplay.innerHTML = '<p class="info">Loading data...</p>';
    
    try {
        const querySnapshot = await getDocs(collection(db, collectionName));
        
        if (querySnapshot.empty) {
            dataDisplay.innerHTML = `
                <div class="empty-message">
                    <p>No documents found in "${collectionName}" collection.</p>
                    <p>This collection might be empty or doesn't exist yet.</p>
                </div>
            `;
            return;
        }
        
        // Prepare data
        const documents = [];
        querySnapshot.forEach((doc) => {
            documents.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        // Store data for filtering
        if (collectionName === 'users') {
            allUsersData = documents;
            addUserFilters();
        } else {
            // Remove filters for non-user collections
            const filterGroup = document.querySelector('.filter-group');
            if (filterGroup) filterGroup.remove();
        }
        
        displayData(collectionName, documents);
        
    } catch (error) {
        console.error('Error fetching data:', error);
        dataDisplay.innerHTML = `
            <div class="error-message">
                <strong>Error fetching data:</strong> ${error.message}
                <br><br>
                <small>Make sure the collection name is correct and you have read permissions.</small>
            </div>
        `;
    }
}

// Display data in a formatted way
function displayData(collectionName, documents) {
    let html = `
        <div class="collection-info">
            <h2>📊 ${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)}</h2>
            <p>Found ${documents.length} document${documents.length !== 1 ? 's' : ''}</p>
        </div>
    `;
    
    // Special handling for users collection
    if (collectionName === 'users') {
        html += createUsersView(documents);
    } else {
        // Get all unique fields from all documents
        const allFields = new Set(['id']);
        documents.forEach(doc => {
            Object.keys(doc).forEach(key => allFields.add(key));
        });
        
        const fields = Array.from(allFields);
        
        // Check if we should use table or card view
        // Use table view if there are few fields, card view for many fields
        if (fields.length <= 6 && documents.length > 0) {
            html += createTableView(documents, fields);
        } else {
            html += createCardView(documents);
        }
    }
    
    dataDisplay.innerHTML = html;
}

// Create specialized view for users
function createUsersView(users) {
    let html = '<div class="users-grid">';
    
    users.forEach(user => {
        const roleEmoji = user.role === 'admin' ? '👑' : user.role === 'moderator' ? '🛡️' : '👤';
        const statusClass = user.isActive ? 'status-active' : 'status-inactive';
        const statusText = user.isActive ? 'Active' : 'Deactivated';
        
        html += `
            <div class="user-card">
                <div class="user-header">
                    <div class="user-avatar">${roleEmoji}</div>
                    <div class="user-title">
                        <h3>${user.firstName} ${user.lastName}</h3>
                        <span class="user-role ${user.role || 'student'}">${(user.role || 'student').toUpperCase()}</span>
                    </div>
                    <span class="user-status ${statusClass}">${statusText}</span>
                </div>
                <div class="user-details">
                    <div class="detail-row">
                        <span class="detail-label">UC ID:</span>
                        <span class="detail-value">${user.ucId}</span>
                    </div>
                    ${user.imei ? `
                    <div class="detail-row">
                        <span class="detail-label">IMEI:</span>
                        <span class="detail-value">${user.imei}</span>
                    </div>
                    ` : ''}
                    <div class="detail-row">
                        <span class="detail-label">Created:</span>
                        <span class="detail-value">${formatDate(user.createdAt)}</span>
                    </div>
                    ${user.lastLogin ? `
                    <div class="detail-row">
                        <span class="detail-label">Last Login:</span>
                        <span class="detail-value">${formatDate(user.lastLogin)}</span>
                    </div>
                    ` : ''}
                    ${user.deactivatedAt ? `
                    <div class="detail-row deactivated-info">
                        <span class="detail-label">Deactivated:</span>
                        <span class="detail-value">${formatDate(user.deactivatedAt)}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="user-id">
                    <small>Document ID: ${user.id}</small>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    return html;
}

// Format date helper
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Create table view for data
function createTableView(documents, fields) {
    let html = '<table class="data-table"><thead><tr>';
    
    // Table headers
    fields.forEach(field => {
        html += `<th>${field}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    // Table rows
    documents.forEach(doc => {
        html += '<tr>';
        fields.forEach(field => {
            const value = doc[field];
            html += `<td>${formatValue(value)}</td>`;
        });
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    return html;
}

// Create card view for data
function createCardView(documents) {
    let html = '';
    
    documents.forEach(doc => {
        html += `<div class="document-card">`;
        html += `<h3>Document ID: ${doc.id}</h3>`;
        
        Object.entries(doc).forEach(([key, value]) => {
            if (key !== 'id') {
                html += `
                    <div class="field">
                        <div class="field-name">${key}:</div>
                        <div class="field-value">${formatValue(value)}</div>
                    </div>
                `;
            }
        });
        
        html += '</div>';
    });
    
    return html;
}

// Format value for display
function formatValue(value) {
    if (value === null || value === undefined) {
        return '<em>null</em>';
    }
    
    if (typeof value === 'object') {
        if (value.toDate && typeof value.toDate === 'function') {
            // Firebase Timestamp
            return value.toDate().toLocaleString();
        }
        return '<pre>' + JSON.stringify(value, null, 2) + '</pre>';
    }
    
    if (typeof value === 'boolean') {
        return value ? '✓ true' : '✗ false';
    }
    
    return String(value);
}

// Event listeners
collectionSelect.addEventListener('change', (e) => {
    const value = e.target.value;
    
    if (value === '__custom__') {
        const customName = prompt('Enter collection name:');
        if (customName && customName.trim()) {
            const trimmedName = customName.trim();
            discoveredCollections.add(trimmedName);
            populateCollections();
            collectionSelect.value = trimmedName;
            fetchCollectionData(trimmedName);
        } else {
            collectionSelect.value = '';
        }
    } else {
        fetchCollectionData(value);
    }
});

refreshBtn.addEventListener('click', () => {
    const selectedCollection = collectionSelect.value;
    if (selectedCollection && selectedCollection !== '__custom__') {
        fetchCollectionData(selectedCollection);
    }
});

// Add button to rediscover collections
const discoverBtn = document.createElement('button');
discoverBtn.textContent = '🔍 Discover Collections';
discoverBtn.id = 'discoverBtn';
discoverBtn.addEventListener('click', async () => {
    discoveredCollections.clear();
    await discoverCollections();
});
document.querySelector('.controls').appendChild(discoverBtn);

// Check for existing session on page load
checkExistingSession();
