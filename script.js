// Spotify API Configuration
// Public-facing Client ID (safe to expose per Spotify API rules)
const SPOTIFY_CLIENT_ID = 'f458f7ee609e467caa9e911027b6ec0f';
const SPOTIFY_REDIRECT_URI = 'https://imkeita.github.io/spotify-now-playing/callback.html';
const SPOTIFY_SCOPES = [
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-modify-playback-state'
].join(' ');

// DOM Elements
const elements = {
    authContainer: document.getElementById('auth-container'),
    loginButton: document.getElementById('login-button'),
    widget: document.querySelector('.now-playing'),
    albumArt: document.querySelector('.album-art'),
    title: document.querySelector('.track-title'),
    artist: document.querySelector('.track-artist'),
    album: document.querySelector('.track-album'),
    progressBar: document.querySelector('.progress-bar'),
    timeInfo: document.querySelector('.time-info')
};

// State
let currentTrack = {
    title: "Not Playing",
    artist: "Connect to Spotify",
    album: "",
    albumArt: "images/album_art_placeholder.png",
    duration: 0,
    progress: 0,
    isPlaying: false
};

let accessToken = null;
let tokenExpiration = 0;
let progressInterval = null;
let apiCheckInterval = null;

// Initialize
function init() {
    // Check for token in URL hash (if coming back from auth)
    const hash = window.location.hash.substring(1);
    if (hash) {
        const params = new URLSearchParams(hash);
        accessToken = params.get('access_token');
        const expiresIn = parseInt(params.get('expires_in')) || 3600;
        tokenExpiration = Date.now() + expiresIn * 1000;
        
        // Store token in session storage
        localStorage.setItem('spotifyAccessToken', accessToken);
        localStorage.setItem('spotifyTokenExpiration', tokenExpiration.toString());
        
        // Remove hash from URL
        history.replaceState(null, null, ' ');
    } else {
        // Check session storage for existing token
        const storedToken = localStorage.getItem('spotifyAccessToken');
        const storedExpiration = localStorage.getItem('spotifyTokenExpiration');
        
        if (storedToken && storedExpiration && Date.now() < parseInt(storedExpiration)) {
            accessToken = storedToken;
            tokenExpiration = parseInt(storedExpiration);
        }
    }
    
    // Set up UI based on auth state
    if (accessToken) {
        startPlayer();
    } else {
        elements.loginButton.addEventListener('click', initiateAuth);
        elements.authContainer.classList.remove('hidden');
    }
    
    // Listen for auth messages from callback
    window.addEventListener('message', handleAuthMessage, false);
}

// Authentication
function initiateAuth() {
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.append('client_id', SPOTIFY_CLIENT_ID);
    authUrl.searchParams.append('response_type', 'token');
    authUrl.searchParams.append('redirect_uri', SPOTIFY_REDIRECT_URI);
    authUrl.searchParams.append('scope', SPOTIFY_SCOPES);
    authUrl.searchParams.append('show_dialog', 'false');
    
    window.open(authUrl.toString(), '_self');
}

function handleAuthMessage(event) {
    if (event.origin !== 'http://127.0.0.1:5500') return;
    
    const hash = event.data.substring(1);
    const params = new URLSearchParams(hash);
    accessToken = params.get('access_token');
    const expiresIn = parseInt(params.get('expires_in')) || 3600;
    tokenExpiration = Date.now() + expiresIn * 1000;
    
    if (accessToken) {
        localStorage.setItem('spotifyAccessToken', accessToken);
        localStorage.setItem('spotifyTokenExpiration', tokenExpiration.toString());
        startPlayer();
    }
}

// Player Functions
function startPlayer() {
    elements.authContainer.classList.add('hidden');
    elements.widget.classList.remove('hidden');
    
    // Start checking for playback updates
    checkPlaybackState();
    apiCheckInterval = setInterval(checkPlaybackState, 3000);
}

async function checkPlaybackState() {
    if (!accessToken || Date.now() >= tokenExpiration) {
        handleTokenExpired();
        return;
    }
    
    try {
        const response = await fetch('https://api.spotify.com/v1/me/player', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        if (response.status === 401) {
            handleTokenExpired();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.is_playing) {
            updateTrackInfo(data);
        } else {
            updateNoPlayback();
        }
    } catch (error) {
        console.error('Error fetching playback state:', error);
        updateNoPlayback();
    }
}

function updateTrackInfo(playbackData) {
    const track = playbackData.item;
    const newTrack = {
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        album: track.album.name,
        albumArt: track.album.images[0]?.url || 'images/album_art_placeholder.png',
        duration: Math.floor(track.duration_ms / 1000),
        progress: Math.floor(playbackData.progress_ms / 1000),
        isPlaying: playbackData.is_playing
    };
    
    // Проверяем, изменились ли метаданные трека (кроме прогресса)
    const { progress: currentProgress, ...currentRest } = currentTrack;
    const { progress: newProgress, ...newRest } = newTrack;
    
    if (JSON.stringify(newRest) !== JSON.stringify(currentRest)) {
        // Метаданные изменились - обновляем весь трек
        changeTrack(newTrack);
    } else {
        // Изменился только прогресс - обновляем только его
        currentTrack.progress = newProgress;
        updateProgress();
    }
}

function updateNoPlayback() {
    const newTrack = {
        title: "Not Playing",
        artist: "No active playback",
        album: "",
        albumArt: "images/album_art_placeholder.png",
        duration: 0,
        progress: 0,
        isPlaying: false
    };
    
    // Проверяем, изменились ли метаданные трека (кроме прогресса)
    const { progress: currentProgress, ...currentRest } = currentTrack;
    const { progress: newProgress, ...newRest } = newTrack;
    
    if (JSON.stringify(newRest) !== JSON.stringify(currentRest)) {
        changeTrack(newTrack);
    } else {
        currentTrack.progress = newProgress;
    }
}

function changeTrack(newTrack) {
    clearInterval(progressInterval);
    currentTrack = { ...newTrack };
    
    updateWidget();
    
    if (currentTrack.isPlaying && currentTrack.duration > 0) {
        progressInterval = setInterval(updateProgress, 1000);
    }
}

function updateWidget() {
    // Add exit animations
    ['title', 'artist', 'album'].forEach(el => elements[el].classList.add('slide-out'));
    elements.albumArt.classList.add('fade-out');
    
    setTimeout(() => {
        // Update content
        elements.title.textContent = currentTrack.title;
        elements.artist.textContent = currentTrack.artist;
        elements.album.textContent = currentTrack.album;
        elements.albumArt.src = currentTrack.albumArt;
        elements.albumArt.alt = `${currentTrack.title} album art`;
        
        // Remove exit animations and add enter animations
        ['title', 'artist', 'album'].forEach((el, i) => {
            elements[el].classList.remove('slide-out');
            setTimeout(() => {
                elements[el].classList.add('slide-in', 'active');
                elements[el].style.setProperty('--opacity', el === 'title' ? 1 : el === 'artist' ? 0.8 : 0.6);
            }, i * 50 + 50);
        });
        
        elements.albumArt.classList.remove('fade-out');
        elements.albumArt.classList.add('fade-in', 'active');
        
        // Clean up animations
        setTimeout(() => {
            ['title', 'artist', 'album'].forEach(el => elements[el].classList.remove('slide-in', 'active'));
            elements.albumArt.classList.remove('fade-in', 'active');
        }, 300);
        
        updateProgress();
    }, 300);
}

// function updateProgress() {
//     if (currentTrack.duration <= 0) return;
    
//     const percent = (currentTrack.progress / currentTrack.duration) * 100;
//     elements.progressBar.style.width = `${percent}%`;
//     elements.timeInfo.innerHTML = `<span>${formatTime(currentTrack.progress)}</span><span>${formatTime(currentTrack.duration)}</span>`;
// }

function updateProgress() {
    if (currentTrack.progress < currentTrack.duration) {
        currentTrack.progress++;
    }
    
    const percent = (currentTrack.progress / currentTrack.duration) * 100;
    elements.progressBar.style.width = `${percent}%`;
    elements.timeInfo.innerHTML = `<span>${formatTime(currentTrack.progress)}</span><span>${formatTime(currentTrack.duration)}</span>`;
}

function formatTime(seconds) {
    if (seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function handleTokenExpired() {
    clearInterval(progressInterval);
    clearInterval(apiCheckInterval);
    localStorage.removeItem('spotifyAccessToken');
    localStorage.removeItem('spotifyTokenExpiration');
    accessToken = null;
    
    elements.widget.classList.add('hidden');
    elements.authContainer.classList.remove('hidden');
}

// Album art error handling
elements.albumArt.onerror = function() {
    this.src = 'images/album_art_placeholder.png';
};

// Initialize the app
init();
