// State
const state = {
    channels: [],
    filteredChannels: [],
    categories: new Set(),
    countries: new Set(),
    countryCodeMap: new Map(),
    detectedCountry: null,
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
const KEY_PLAYLIST = 'iptv_playlist_url';
const DEFAULT_PLAYLIST = 'https://iptv-org.github.io/iptv/index.m3u';

// Settings Elements
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const playlistInput = document.getElementById('playlist-url');
const btnSavePlaylist = document.getElementById('btn-save-playlist');
const btnResetPlaylist = document.getElementById('btn-reset-playlist');

// Initialize
async function init() {
    loadState();

    // Auto-detect country (non-blocking)
    detectCountry();

    const playlistUrl = localStorage.getItem(KEY_PLAYLIST) || DEFAULT_PLAYLIST;

    try {
        const response = await fetch(playlistUrl);
        if (!response.ok) throw new Error('Failed to download playlist');
        const text = await response.text();

        parseM3U(text);
        updateFilters();

        // Apply detected country if available
        applyCountryDetection();

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
function applyCountryDetection() {
    if (!state.detectedCountry) return;
    if (state.countries.size === 0) return;

    const data = state.detectedCountry;
    const countryName = data.country_name;

    if (countryName) {
        console.log('Detected Country:', countryName);
        if (state.countries.has(countryName)) {
            countrySelect.value = countryName;
            state.selectedCountry = countryName;
            filterChannels();
        } else if (data.country_code && state.countryCodeMap.has(data.country_code)) {
            // Try code if name mismatch (e.g. US vs United States)
            const mappedName = state.countryCodeMap.get(data.country_code);
            countrySelect.value = mappedName;
            state.selectedCountry = mappedName;
            filterChannels();
        }
    }
}

async function detectCountry() {
    try {
        const res = await fetch('https://ipapi.co/json/');
        if (res.ok) {
            const data = await res.json();
            if (data.country_name) {
                state.detectedCountry = data;
                applyCountryDetection();
            }
        }
    } catch (e) {
        console.log('Geo-detection failed', e);
    }
}

// Parser
function parseM3U(content) {
    const lines = content.split('\n');
    state.channels = [];
    state.categories = new Set();
    state.countries = new Set();
    state.countryCodeMap = new Map();

    let channelIndex = 1;
    let currentChannel = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            const idMatch = line.match(/tvg-id="([^"]*)"/);
            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            const groupMatch = line.match(/group-title="([^"]*)"/);

            const commaIdx = line.lastIndexOf(',');
            const name = line.substring(commaIdx + 1).trim();
            const group = groupMatch ? groupMatch[1] : 'Uncategorized';
            const tvgId = idMatch ? idMatch[1] : `gen_${channelIndex}`; // Fallback ID

            // Extract country
            let countryCode = 'Unknown';
            let countryName = 'International';

            if (idMatch && idMatch[1]) {
                const parts = idMatch[1].split('@')[0].split('.');
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.length === 2) {
                    countryCode = lastPart.toUpperCase();
                    try {
                        countryName = regionNames.of(countryCode) || countryCode;
                    } catch (e) {
                        countryName = countryCode;
                    }
                    state.countryCodeMap.set(countryCode, countryName);
                }
            }

            const sn = channelIndex++;

            currentChannel = {
                id: tvgId,
                logo: logoMatch ? logoMatch[1] : '',
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
function renderList(append = false) {
    let startIdx = 0;

    if (append) {
        // If appending, start from where we left off
        // (accounting for potential placeholder message)
        if (!listContainer.querySelector('.channel-item')) {
            startIdx = 0;
        } else {
            startIdx = listContainer.querySelectorAll('.channel-item').length;
        }
    } else {
        // Save scroll position if re-rendering in place
        // (Only strictly needed if we want to preserve scroll on favorite toggle, etc.)
        // But if filtering, we usually want to go to top.
        // We'll let the caller handle scroll reset if needed, or just let it be.
        // For simplicity: Clear everything.
        listContainer.innerHTML = '';
    }

    const displayList = state.filteredChannels.slice(startIdx, state.pageSize);

    if (displayList.length === 0 && !append) {
        listContainer.innerHTML = '<div class="placeholder-msg">No channels found</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    displayList.forEach((ch, idx) => {
        const isFav = state.favorites.has(ch.id);
        const el = document.createElement('div');
        el.className = 'channel-item';

        if (state.filteredChannels[state.currentIdx] === ch) {
            el.classList.add('active');
        }

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

    // If append, remove placeholder if exists (though unlikely if we are appending)
    if (append) {
        const msg = listContainer.querySelector('.placeholder-msg');
        if (msg) msg.remove();
    }

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

    // Reset page
    state.pageSize = 100;
    renderList(false);
    listContainer.scrollTop = 0;
}

function selectChannel(channel) {
    if (!channel) return;

    // Store last channel
    localStorage.setItem(KEY_LAST_CHANNEL, channel.id);

    const idx = state.filteredChannels.indexOf(channel);
    state.currentIdx = idx;

    // Update active class
    const items = document.querySelectorAll('.channel-item');
    items.forEach(el => el.classList.remove('active'));

    // Try to highlight the specific element if rendered
    const renderedItems = listContainer.querySelectorAll('.channel-item');
    if (renderedItems[idx]) {
        renderedItems[idx].classList.add('active');
        renderedItems[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

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

// Utils
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

searchInput.addEventListener('input', debounce(filterChannels, 500));
categorySelect.addEventListener('change', () => {
    state.selectedCategory = categorySelect.value;
    filterChannels();
});
countrySelect.addEventListener('change', () => {
    state.selectedCountry = countrySelect.value;
    filterChannels();
});

// Settings Modal Logic
btnSettings.onclick = () => {
    modalSettings.classList.remove('hidden');
    playlistInput.value = localStorage.getItem(KEY_PLAYLIST) || DEFAULT_PLAYLIST;
};

closeSettings.onclick = () => {
    modalSettings.classList.add('hidden');
};

modalSettings.onclick = (e) => {
    if (e.target === modalSettings || e.target.classList.contains('modal-overlay')) {
        modalSettings.classList.add('hidden');
    }
};

btnSavePlaylist.onclick = () => {
    const url = playlistInput.value.trim();
    if (url) {
        localStorage.setItem(KEY_PLAYLIST, url);
        location.reload();
    }
};

btnResetPlaylist.onclick = () => {
    localStorage.removeItem(KEY_PLAYLIST);
    location.reload();
};

// Infinite Scroll
listContainer.addEventListener('scroll', () => {
    if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 200) {
        if (state.pageSize < state.filteredChannels.length) {
            state.pageSize += 50;
            renderList(true);
        }
    }
});

// Keyboard Navigation
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    if (e.code === 'Space') {
        e.preventDefault();
        if (video.paused) video.play(); else video.pause();
    } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        navigateChannel(-1);
    } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        navigateChannel(1);
    }
});

function navigateChannel(direction) {
    if (state.filteredChannels.length === 0) return;
    let newIdx = state.currentIdx + direction;

    if (newIdx < 0) newIdx = 0;
    if (newIdx >= state.filteredChannels.length) newIdx = state.filteredChannels.length - 1;

    // Auto-load if navigating past rendered list
    if (newIdx >= state.pageSize) {
        state.pageSize = newIdx + 20;
        renderList(true);
    }

    selectChannel(state.filteredChannels[newIdx]);
}

init();
