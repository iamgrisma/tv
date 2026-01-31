// State
const state = {
    channels: [],
    filteredChannels: [],
    categories: new Set(),
    countries: new Set(),
    currentIdx: -1,
    pageSize: 100,
    searchQuery: '',
    selectedCategory: 'all',
    selectedCountry: 'all',
    showFavoritesOnly: false,
    favorites: new Set(),  // Stores channel IDs (tvg-id)
    loadingCountry: true
};

// Elements
const video = document.getElementById('video');
const listContainer = document.getElementById('channel-list');
const searchInput = document.getElementById('search-input');
const categorySelect = document.getElementById('category-filter');
const countrySelect = document.getElementById('country-filter');
const btnFavorites = document.getElementById('btn-favorites');
const countLabel = document.getElementById('channel-count');
const titleEl = document.getElementById('current-title');
const catEl = document.getElementById('current-category');
const logoEl = document.getElementById('current-logo');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

let hls = null;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

// STORAGE KEYS
const KEY_FAVORITES = 'iptv_favorites';
const KEY_LAST_CHANNEL = 'iptv_last_channel';

// Initialize
async function init() {
    loadState();

    // Auto-detect country (non-blocking)
    detectCountry();

    try {
        const response = await fetch('https://iptv-org.github.io/iptv/index.m3u');
        if (!response.ok) throw new Error('Failed to download playlist');
        const text = await response.text();

        parseM3U(text);
        updateFilters();

        // Restore last played channel if available
        const lastId = localStorage.getItem(KEY_LAST_CHANNEL);
        if (lastId) {
            const lastCh = state.channels.find(c => c.id === lastId);
            if (lastCh) {
                selectChannel(lastCh);
            }
        }

        // Initial render (might be filtered by country later)
        filterChannels();

    } catch (err) {
        listContainer.innerHTML = `<div class="placeholder-msg">Error: ${err.message}</div>`;
    }
}

// Persistence
function loadState() {
    try {
        const savedFavs = JSON.parse(localStorage.getItem(KEY_FAVORITES) || '[]');
        state.favorites = new Set(savedFavs);
        updateFavoriteButtonState();
    } catch (e) {
        console.error('Failed to load favorites', e);
    }
}

function saveFavorites() {
    localStorage.setItem(KEY_FAVORITES, JSON.stringify([...state.favorites]));
}

function toggleFavorite(channelId, e) {
    if (e) e.stopPropagation();

    if (state.favorites.has(channelId)) {
        state.favorites.delete(channelId);
    } else {
        state.favorites.add(channelId);
    }
    saveFavorites();
    renderList(); // Re-render to update icons

    // If we are in favorites view, refilter to remove un-favorited item
    if (state.showFavoritesOnly) {
        filterChannels();
    }
}

function updateFavoriteButtonState() {
    const icon = btnFavorites.querySelector('i');
    if (state.showFavoritesOnly) {
        btnFavorites.classList.add('active');
        icon.className = 'fa-solid fa-star';
    } else {
        btnFavorites.classList.remove('active');
        icon.className = 'fa-regular fa-star';
    }
}

// Geolocation
async function detectCountry() {
    try {
        const res = await fetch('https://ipapi.co/json/');
        if (res.ok) {
            const data = await res.json();
            const countryName = data.country_name;
            if (countryName) {
                console.log('Detected Country:', countryName);
                if (state.countries.has(countryName)) {
                    countrySelect.value = countryName;
                    state.selectedCountry = countryName;
                    filterChannels();
                } else {
                    // Try code if name mismatch (e.g. US vs United States)
                    // Simplified: just match known names for now
                }
            }
        }
    } catch (e) {
        console.log('Geo-detection failed', e);
    }
}

// Parser
function getAttribute(line, key) {
    const search = key + '="';
    const start = line.indexOf(search);
    if (start === -1) return null;
    const valueStart = start + search.length;
    const valueEnd = line.indexOf('"', valueStart);
    if (valueEnd === -1) return null;
    return line.substring(valueStart, valueEnd);
}

function parseM3U(content) {
    const lines = content.split('\n');
    state.channels = [];
    state.categories = new Set();
    state.countries = new Set();

    let channelIndex = 1;
    let currentChannel = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            const tvgIdVal = getAttribute(line, 'tvg-id');
            const logoVal = getAttribute(line, 'tvg-logo');
            const groupVal = getAttribute(line, 'group-title');

            const commaIdx = line.lastIndexOf(',');
            const name = line.substring(commaIdx + 1).trim();
            const group = groupVal !== null ? groupVal : 'Uncategorized';
            const tvgId = tvgIdVal !== null ? tvgIdVal : `gen_${channelIndex}`; // Fallback ID

            // Extract country
            let countryCode = 'Unknown';
            let countryName = 'International';

            if (tvgIdVal) {
                const parts = tvgIdVal.split('@')[0].split('.');
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.length === 2) {
                    countryCode = lastPart.toUpperCase();
                    try {
                        countryName = regionNames.of(countryCode) || countryCode;
                    } catch (e) {
                        countryName = countryCode;
                    }
                }
            }

            const sn = channelIndex++;

            currentChannel = {
                id: tvgId,
                logo: logoVal || '',
                group: group,
                name: name || 'Unknown Channel',
                sn: sn,
                country: countryName,
                searchStr: `${sn} ${name} ${group} ${countryName}`.toLowerCase()
            };

            if (group) state.categories.add(group);
            if (countryName) state.countries.add(countryName);

        } else if (line.startsWith('http')) {
            if (currentChannel.name) {
                currentChannel.url = line;
                state.channels.push(currentChannel);
                currentChannel = {};
            }
        }
    }

    // Sort filters
    state.categories = new Set(Array.from(state.categories).sort());
    state.countries = new Set(Array.from(state.countries).sort());

    state.filteredChannels = [...state.channels];
}

function updateFilters() {
    // Categories
    categorySelect.innerHTML = '<option value="all">All Categories</option>';
    state.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
    });

    // Countries
    countrySelect.innerHTML = '<option value="all">All Countries</option>';
    state.countries.forEach(ctry => {
        const opt = document.createElement('option');
        opt.value = ctry;
        opt.textContent = ctry;
        countrySelect.appendChild(opt);
    });
}

// Render
function renderList() {
    listContainer.innerHTML = '';

    // Chunking for performance if list is huge? 
    // For now, just slice
    const displayList = state.filteredChannels.slice(0, state.pageSize);

    if (displayList.length === 0) {
        listContainer.innerHTML = '<div class="placeholder-msg">No channels found</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    displayList.forEach((ch, idx) => {
        const isFav = state.favorites.has(ch.id);
        const el = document.createElement('div');
        el.className = `channel-item ${state.currentIdx === idx && state.filteredChannels[state.currentIdx] === ch ? 'active' : ''}`;

        el.innerHTML = `
            <div class="ch-sn">#${ch.sn}</div>
            <div class="ch-logo">
                ${ch.logo ? `<img src="${ch.logo}" loading="lazy" onerror="this.style.display='none'">` : '<i class="fa-solid fa-tv"></i>'}
            </div>
            <div class="ch-info">
                <div class="channel-name">${ch.name}</div>
                <div class="channel-meta">
                    <span class="meta-tag">${ch.country}</span>
                    <span>•</span>
                    <span>${ch.group}</span>
                </div>
            </div>
            <div class="ch-action">
                <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-star fav-icon" 
                   onclick="toggleFavorite('${ch.id}', event)" 
                   title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}"></i>
            </div>
        `;

        el.onclick = () => selectChannel(ch);
        fragment.appendChild(el);
    });

    listContainer.appendChild(fragment);
    countLabel.textContent = `${state.filteredChannels.length} channels`;
}

// Actions
function filterChannels() {
    const q = searchInput.value.toLowerCase();
    const cat = categorySelect.value;
    const ctry = countrySelect.value;

    state.filteredChannels = state.channels.filter(ch => {
        const matchesSearch = !q || ch.searchStr.includes(q);
        const matchesCat = cat === 'all' || ch.group === cat;
        const matchesCtry = ctry === 'all' || ch.country === ctry;
        const matchesFav = !state.showFavoritesOnly || state.favorites.has(ch.id);

        return matchesSearch && matchesCat && matchesCtry && matchesFav;
    });

    // Reset page or list position
    renderList();
}

function selectChannel(channel) {
    if (!channel) return;

    // Store last channel
    localStorage.setItem(KEY_LAST_CHANNEL, channel.id);

    const idx = state.filteredChannels.indexOf(channel);
    state.currentIdx = idx; // Note: if filtered out, this might be -1, but that's ok

    const items = document.querySelectorAll('.channel-item');
    items.forEach(el => el.classList.remove('active'));

    titleEl.textContent = channel.name;
    catEl.textContent = `${channel.country} | ${channel.group}`;

    if (channel.logo) {
        logoEl.src = channel.logo;
        logoEl.style.display = 'block';
    } else {
        logoEl.style.display = 'none';
    }

    loadstream(channel.url);
}

function loadstream(source) {
    if (Hls.isSupported()) {
        if (hls) hls.destroy();
        hls = new Hls();
        hls.loadSource(source);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play().catch(e => console.log(e));
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = source;
        video.addEventListener('loadedmetadata', function () {
            video.play().catch(e => console.log(e));
        });
    }
}

// Event Listeners
btnPrev.onclick = () => {
    if (state.filteredChannels.length === 0) return;
    let newIdx = state.currentIdx - 1;
    if (newIdx < 0) newIdx = state.filteredChannels.length - 1;
    selectChannel(state.filteredChannels[newIdx]);
};

btnNext.onclick = () => {
    if (state.filteredChannels.length === 0) return;
    let newIdx = state.currentIdx + 1;
    if (newIdx >= state.filteredChannels.length) newIdx = 0;
    selectChannel(state.filteredChannels[newIdx]);
};

btnFavorites.onclick = () => {
    state.showFavoritesOnly = !state.showFavoritesOnly;
    updateFavoriteButtonState();
    filterChannels();
};

searchInput.addEventListener('input', filterChannels);
categorySelect.addEventListener('change', () => {
    state.selectedCategory = categorySelect.value;
    filterChannels();
});
countrySelect.addEventListener('change', () => {
    state.selectedCountry = countrySelect.value;
    filterChannels();
});

init();
