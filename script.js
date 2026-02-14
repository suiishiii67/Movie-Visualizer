const canvas = document.getElementById("canvas");
const API_KEY = "e9c305d41763f7172d62fbfc090f7793";
const IMG_URL = "https://image.tmdb.org/t/p/w500";

const tileW = 220, tileH = 320;
let renderX = 0, renderY = 0, targetX = 0, targetY = 0, scale = 1, targetScale = 1;
let isDragging = false, lastX = 0, lastY = 0;

const world = new Map(), movieDataMap = new Map();
let moviePool = [], currentPage = 1, isFetching = false;
let currentGenre = "", currentSort = "popularity.desc", dateFilter = "", voteThreshold = 100;

let isLocked = false, activeMovie = null, lockedPosterElement = null; 
const globalInfo = document.getElementById("global-info-box");
const scrollBox = document.getElementById("info-scroll-box");
const watchlistModal = document.getElementById("watchlist-modal");

let watchlist = JSON.parse(localStorage.getItem("movieWatchlist")) || [];

function updateWatchlistUI() {
    document.getElementById("wl-count").innerText = watchlist.length;
    localStorage.setItem("movieWatchlist", JSON.stringify(watchlist));
}
updateWatchlistUI();

/* ---------------- CUSTOM DROPDOWN LOGIC ---------------- */
const customDropdown = document.getElementById("custom-genre-dropdown");
if (customDropdown) {
    const dropdownHeader = customDropdown.querySelector(".dropdown-header");
    const dropdownText = customDropdown.querySelector(".dropdown-header span");
    const dropdownOptions = customDropdown.querySelectorAll(".dropdown-list li");

    dropdownHeader.addEventListener("click", (e) => {
        e.stopPropagation();
        customDropdown.classList.toggle("open");
    });

    window.addEventListener("click", () => customDropdown.classList.remove("open"));

    dropdownOptions.forEach(option => {
        option.addEventListener("click", async (e) => {
            dropdownText.innerText = e.target.innerText;
            currentGenre = e.target.getAttribute("data-value");
            customDropdown.classList.remove("open");
            currentSort = "popularity.desc";
            dateFilter = "";
            voteThreshold = 100;
            await resetUniverse();
        });
    });
}

/* ---------------- NAV LOGIC ---------------- */
async function setFilter(type) {
    if (type === 'recent') {
        currentSort = "primary_release_date.desc";
        dateFilter = "";
        voteThreshold = 100;
    } else if (type === 'liked') {
        currentSort = "vote_average.desc";
        dateFilter = "";
        voteThreshold = 100;
    } else if (type === 'recent_liked') {
        currentSort = "vote_average.desc";
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        dateFilter = `&primary_release_date.gte=${twoYearsAgo.toISOString().split('T')[0]}`;
        voteThreshold = 50; 
    }
    await resetUniverse();
}

async function resetUniverse() {
    movieDataMap.clear(); moviePool = []; currentPage = 1;
    world.forEach(el => el !== "loading" && el.parentNode === canvas && canvas.removeChild(el));
    world.clear();
    await fetchMoreMovies();
}

/* ---------------- DATA FETCHING ---------------- */
async function fetchMoreMovies() {
    if (isFetching) return;
    isFetching = true;
    try {
        let url = `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=${currentGenre}&sort_by=${currentSort}${dateFilter}&page=${currentPage}&vote_count.gte=${voteThreshold}`;
        const res = await fetch(url);
        const data = await res.json();
        // OPTIMIZATION: Ensure we don't fetch duplicates
        const newMovies = data.results.filter(m => m.poster_path && !moviePool.find(ex => ex.id === m.id));
        moviePool.push(...newMovies);
        currentPage++;
    } catch (e) {} finally { isFetching = false; }
}

async function getMovieForCoordinate(x, y) {
    const key = `${x},${y}`;
    if (movieDataMap.has(key)) return movieDataMap.get(key);
    if (moviePool.length < 20) await fetchMoreMovies();
    const movie = moviePool.shift();
    if (movie) { movieDataMap.set(key, movie); return movie; }
    return null;
}

/* ---------------- OPTIMIZED WORLD ENGINE (Culling Fix) ---------------- */
function updateWorld() {
    const startCol = Math.floor((-renderX / scale) / tileW) - 1;
    const endCol = Math.floor(((-renderX + window.innerWidth) / scale) / tileW) + 1;
    const startRow = Math.floor((-renderY / scale) / tileH) - 1;
    const endRow = Math.floor(((-renderY + window.innerHeight) / scale) / tileH) + 1;

    for (let y = startRow; y <= endRow; y++) {
        for (let x = startCol; x <= endCol; x++) { createPoster(x, y); }
    }

    // CULLING: Remove posters far away from viewport to save RAM on low-end laptops
    world.forEach((el, key) => {
        const [kx, ky] = key.split(',').map(Number);
        // Increased buffer to 6 tiles to prevent flickering or deletion while hovering
        if (kx < startCol - 6 || kx > endCol + 6 || ky < startRow - 6 || ky > endRow + 6) {
            if (el !== "loading" && el.parentNode) {
                // NEVER delete the poster the user has currently locked!
                if (el !== lockedPosterElement) {
                    canvas.removeChild(el);
                    world.delete(key);
                }
            }
        }
    });
}

async function createPoster(gridX, gridY) {
    const key = `${gridX},${gridY}`;
    if (world.has(key)) return;
    world.set(key, "loading");

    const movie = await getMovieForCoordinate(gridX, gridY);
    if (!movie) { world.delete(key); return; }

    const div = document.createElement("div");
    div.className = "poster loading";
    div.style.width = "200px"; div.style.height = "300px";
    div.style.left = gridX * tileW + "px"; div.style.top = gridY * tileH + "px";
    div.style.position = "absolute";
    div.movieData = movie; 

    const img = new Image();
    img.src = IMG_URL + movie.poster_path;
    img.draggable = false;
    img.onload = () => { img.classList.add('loaded'); div.classList.remove('loading'); };

    const addBtn = document.createElement("button");
    addBtn.className = "poster-add-btn";
    
    const checkStatus = () => {
        const isAdded = watchlist.some(m => m.id === movie.id);
        addBtn.innerHTML = isAdded ? "✓" : "＋";
        addBtn.classList.toggle("added", isAdded);
    };

    addBtn.onclick = (e) => {
        e.stopPropagation();
        if (!watchlist.some(m => m.id === movie.id)) {
            watchlist.push(movie);
            updateWatchlistUI();
            checkStatus();
        }
    };

    div.addEventListener("mouseenter", () => { 
        if(!isLocked && (!customDropdown || !customDropdown.classList.contains("open"))) {
            showMovieInfo(movie); 
        }
    });
    div.addEventListener("mouseleave", () => { if(!isLocked) globalInfo.classList.remove("active"); });
    
    div.addEventListener("dblclick", () => {
        if (lockedPosterElement && lockedPosterElement !== div) {
            lockedPosterElement.querySelector('.poster-add-btn')?.classList.remove('active');
        }
        isLocked = true;
        lockedPosterElement = div;
        activeMovie = movie;
        
        // FIX: Force update the info card immediately on double-click
        showMovieInfo(movie); 
        
        globalInfo.classList.add("active", "locked");
        checkStatus(); 
        addBtn.classList.add("active"); 
    });

    div.append(img, addBtn);
    canvas.appendChild(div);
    world.set(key, div);
}

async function showMovieInfo(movie) {
    document.getElementById("info-title").innerText = movie.title;
    document.getElementById("info-year").innerText = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
    document.getElementById("info-rating").innerText = `★ ${movie.vote_average.toFixed(1)}`;
    document.getElementById("info-desc").innerText = movie.overview;
    
    try {
        const detailRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${API_KEY}&append_to_response=credits,release_dates`);
        const d = await detailRes.json();
        document.getElementById("info-genres").innerHTML = `<strong>Genres:</strong> ${d.genres.map(g => g.name).join(", ")}`;
        document.getElementById("info-director").innerHTML = `<strong>Dir:</strong> ${d.credits.crew.find(c => c.job === "Director")?.name || 'N/A'}`;
        document.getElementById("info-cast").innerHTML = `<strong>Cast:</strong> ${d.credits.cast.slice(0, 3).map(c => c.name).join(", ")}`;
        document.getElementById("info-runtime").innerHTML = `<strong>Time:</strong> ${d.runtime}m`;
        const usRel = d.release_dates.results.find(r => r.iso_3166_1 === "US") || d.release_dates.results[0];
        document.getElementById("info-cert").innerText = usRel?.release_dates[0].certification || "NR";
    } catch (e) {}
    
    globalInfo.classList.add("active");
    scrollBox.scrollTop = 0;
}

/* ---------------- WATCHLIST LOGIC ---------------- */
function toggleWatchlist() {
    const modal = document.getElementById("watchlist-modal");
    modal.style.display = (modal.style.display === "block") ? "none" : "block";
    if (modal.style.display === "block") renderWatchlistGrid();
}

function renderWatchlistGrid() {
    const grid = document.getElementById("watchlist-grid");
    grid.innerHTML = "";
    if (watchlist.length === 0) {
        grid.innerHTML = `<p style="color: rgba(255,255,255,0.5); grid-column: 1/-1; text-align: center;">Your watchlist is currently empty.</p>`;
        return;
    }
    watchlist.forEach(m => {
        const item = document.createElement("div");
        item.className = "wl-item";
        item.style.viewTransitionName = `card-${m.id}`; 
        item.innerHTML = `
            <div class="wl-img-wrapper">
                <img src="${IMG_URL + m.poster_path}" alt="Poster">
                <button class="remove-btn" onclick="removeFromWL(${m.id}, this)" title="Remove">✕</button>
            </div>
            <div class="wl-info"><div class="wl-title">${m.title}</div></div>
        `;
        grid.appendChild(item);
    });
}

function removeFromWL(id, btnElement) {
    watchlist = watchlist.filter(m => m.id !== id);
    updateWatchlistUI();
    
    document.querySelectorAll('.poster-add-btn').forEach(btn => {
        if (btn.parentNode.movieData?.id === id) {
            btn.classList.remove('added');
            btn.innerHTML = '＋';
        }
    });

    if (btnElement && document.startViewTransition) {
        btnElement.closest('.wl-item').classList.add('removing');
        setTimeout(() => document.startViewTransition(() => renderWatchlistGrid()), 150);
    } else {
        renderWatchlistGrid();
    }
}

/* ---------------- INPUT & CAMERA ENGINE ---------------- */
window.addEventListener("wheel", e => {
    if (watchlistModal.style.display === "block" || e.target.closest('.dropdown-list')) return;
    if (isLocked) { scrollBox.scrollTop += e.deltaY; return; }
    
    e.preventDefault();
    const worldX = (e.clientX - targetX) / targetScale, worldY = (e.clientY - targetY) / targetScale;
    // OPTIMIZATION: Keep zoom-out limited for performance
    targetScale = Math.min(Math.max(0.55, targetScale - e.deltaY * 0.0015), 1.3);
    targetX = e.clientX - worldX * targetScale; targetY = e.clientY - worldY * targetScale;
}, { passive: false });

function animate() {
    scale += (targetScale - scale) * 0.08;
    renderX += (targetX - renderX) * 0.08; renderY += (targetY - renderY) * 0.08;
    canvas.style.transform = `translate(${renderX}px, ${renderY}px) scale(${scale})`;
    updateWorld();
    requestAnimationFrame(animate);
}

window.addEventListener("mousedown", e => {
    if (watchlistModal.style.display === "block" || e.target.closest('nav') || e.target.closest('.info-container-wrapper')) return;
    
    if (isLocked && !e.target.closest('.poster')) {
        isLocked = false;
        lockedPosterElement?.querySelector('.poster-add-btn')?.classList.remove('active');
        lockedPosterElement = null;
        globalInfo.classList.remove("active", "locked");
    }
    isDragging = true; lastX = e.clientX; lastY = e.clientY;
    document.body.style.cursor = "grabbing";
});

window.addEventListener("mouseup", () => { isDragging = false; document.body.style.cursor = "grab"; });

window.addEventListener("mousemove", e => {
    if (watchlistModal.style.display === "block") return;
    if (isLocked) {
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        const hoveredPoster = elements.find(el => el.classList?.contains('poster'));
        const isOverUI = elements.some(el => el.closest?.('.info-container-wrapper') || el.closest?.('.glass-nav'));

        if (hoveredPoster && hoveredPoster !== lockedPosterElement && !isOverUI) {
            isLocked = false;
            lockedPosterElement?.querySelector('.poster-add-btn')?.classList.remove('active');
            lockedPosterElement = null;
            globalInfo.classList.remove("locked");
            showMovieInfo(hoveredPoster.movieData);
        }
    }
    if (!isDragging) return;
    targetX += e.clientX - lastX; targetY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
});

fetchMoreMovies().then(() => animate());