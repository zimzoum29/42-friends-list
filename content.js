console.log("[42 Friends] Script amis chargé");

const FRIENDS_KEY = "friendsList_42_intra";
const PROFILE_INFO_KEY = "friendsProfileInfo_42_intra";
const BASE_PROFILE_URL = "https://profile.intra.42.fr/users/";

// ---------- Utils DOM ready ----------
function onDomReady(callback) {
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    callback();
  } else {
    document.addEventListener("DOMContentLoaded", callback);
  }
}

// Petit utilitaire pour attendre qu'un élément existe
function waitForElement(selector, timeout = 8000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const start = Date.now();
    const interval = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        resolve(null);
      }
    }, 200);
  });
}

// ---------- Storage helpers ----------
function loadFriends() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([FRIENDS_KEY], (result) => {
      resolve(result[FRIENDS_KEY] || []);
    });
  });
}

function saveFriends(friends) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [FRIENDS_KEY]: friends }, () => resolve());
  });
}

function loadProfileInfoCache() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([PROFILE_INFO_KEY], (result) => {
      resolve(result[PROFILE_INFO_KEY] || {});
    });
  });
}

function saveProfileInfoCache(cache) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [PROFILE_INFO_KEY]: cache }, () => resolve());
  });
}

// ---------- Récupération avatar + status via iframe ----------

function applyStatusToBadge(statusText, badgeEl) {
  if (!badgeEl || !badgeEl.isConnected) return;

  badgeEl.classList.remove("friends-42-status-online", "friends-42-status-offline");

  let text = (statusText || "").trim();
  const lower = text.toLowerCase();

  const isUnavailable =
    !text ||
    lower === "unavailable" ||
    lower === "unvailable" || // au cas où
    lower.includes("unavailable");

  if (isUnavailable) {
    badgeEl.textContent = "Unavailable";
    badgeEl.classList.add("friends-42-status-offline");
  } else {
    badgeEl.textContent = text;
    badgeEl.classList.add("friends-42-status-online");
  }
}

// Utilise un iframe caché pour charger la page profil et extraire avatar + status
function loadProfileInfoViaIframe(login, avatarEl, statusBadgeEl) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "absolute";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  iframe.setAttribute("aria-hidden", "true");

  iframe.src = BASE_PROFILE_URL + encodeURIComponent(login);

  iframe.onload = async () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) {
        console.warn("[42 Friends] Pas de doc dans l'iframe pour", login);
        avatarEl && (avatarEl.style.display = "none");
        applyStatusToBadge("Unavailable", statusBadgeEl);
        iframe.remove();
        return;
      }

      // ----- Avatar -----
      let avatarDiv =
        doc.querySelector(".bg-image-item.profile-image.rounded.user-image") ||
        doc.querySelector('.bg-image-item.profile-image[style*="background-image"]');

      let avatarUrl = null;
      if (avatarDiv) {
        const styleAttr = avatarDiv.getAttribute("style") || "";
        const match = styleAttr.match(
          /background-image:\s*url\((['"]?)(.*?)\1\)/
        );
        if (match && match[2]) {
          avatarUrl = match[2];
        }
      }

      if (avatarEl && avatarEl.isConnected) {
        if (avatarUrl) {
          avatarEl.src = avatarUrl;
        } else {
          avatarEl.style.display = "none";
        }
      }

      // ----- Status -----
      const statusDiv = doc.querySelector(".user-poste-status");
      let statusText = null;
      if (statusDiv) {
        statusText = statusDiv.textContent.replace(/\s+/g, " ").trim();
      }

      applyStatusToBadge(statusText, statusBadgeEl);

      // ----- Cache -----
      const cache = await loadProfileInfoCache();
      cache[login.toLowerCase()] = {
        avatarUrl: avatarUrl || null,
        statusText: statusText || null,
      };
      await saveProfileInfoCache(cache);
    } catch (e) {
      console.warn("[42 Friends] Erreur lors de la lecture iframe pour", login, e);
      if (avatarEl) avatarEl.style.display = "none";
      applyStatusToBadge("Unavailable", statusBadgeEl);
    } finally {
      iframe.remove();
    }
  };

  document.body.appendChild(iframe);
}

// Résout avatar + status pour un login donné (cache + iframe si besoin)
async function ensureProfileInfo(login, avatarEl, statusBadgeEl) {
  const lower = login.toLowerCase();
  const cache = await loadProfileInfoCache();

  const cached = cache[lower];
  if (cached) {
    // Avatar
    if (avatarEl && avatarEl.isConnected) {
      if (cached.avatarUrl) {
        avatarEl.src = cached.avatarUrl;
      } else {
        avatarEl.style.display = "none";
      }
    }
    // Status
    applyStatusToBadge(cached.statusText, statusBadgeEl);
    return;
  }

  // Sinon, on va chercher via iframe
  loadProfileInfoViaIframe(login, avatarEl, statusBadgeEl);
}

// ---------- Création du panneau Amis ----------
function createFriendsPanel() {
  const panel = document.createElement("div");
  panel.id = "friends-42-panel";
  // classes utilisées par les rectangles de l'intra
  panel.className = "container-inner-item boxed friends-42-card";

  panel.innerHTML = `
    <header class="friends-42-card-header">
      <h2 class="profile-title">FRIENDS</h2>
      <p class="friends-42-card-subtitle">Accès rapide aux profils de tes amis</p>
    </header>

    <form id="friends-42-form" class="friends-42-form">
      <input 
        id="friends-42-input" 
        type="text" 
        placeholder="Ajouter un login (ex: tigondra)" 
        autocomplete="off"
      />
      <button type="submit">ADD</button>
    </form>

    <div id="friends-42-list" class="friends-42-list"></div>
  `;

  // Style pour l'intérieur du bloc Friends
  const style = document.createElement("style");
  style.textContent = `
    .friends-42-card-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 10px;
    }

    .friends-42-card-subtitle {
      margin: 0;
      font-size: 11px;
      color: #999;
    }

    .friends-42-form {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
      margin-top: 4px;
    }

    #friends-42-input {
      flex: 1;
      padding: 5px 10px;
      border-radius: 3px;
      border: 1px solid #ddd;
      background: #fafafa;
      color: #333;
      font-size: 12px;
      outline: none;
    }

    #friends-42-input:focus {
      border-color: #27d1c3;
      box-shadow: 0 0 0 1px rgba(39,209,195,0.4);
      background: #ffffff;
    }

    #friends-42-form button {
      padding: 6px 14px;
      border-radius: 3px;
      border: 1px solid #00babc;
      background: #00babc;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      cursor: pointer;
      transition: background 0.15s ease-out, transform 0.05s ease-out, box-shadow 0.15s ease-out;
    }

    #friends-42-form button:hover {
      background: #2fe0d1;
      box-shadow: 0 1px 3px rgba(0,0,0,0.18);
      transform: translateY(-1px);
    }

    #friends-42-form button:active {
      transform: translateY(0);
      box-shadow: none;
    }

    .friends-42-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 6px;
      max-height: 280px;       /* scroll interne dans le rectangle */
      overflow-y: auto;
      padding-right: 4px;
    }

    .friends-42-list::-webkit-scrollbar {
      width: 6px;
    }

    .friends-42-list::-webkit-scrollbar-thumb {
      background: #cccccc;
      border-radius: 4px;
    }

    .friends-42-list::-webkit-scrollbar-thumb:hover {
      background: #b8b8b8;
    }

    .friends-42-list::-webkit-scrollbar-track {
      background: transparent;
    }

    .friends-42-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #373c48;
      border-radius: 3px;
      padding: 4px 8px;
      border: 1px solid #00babc;
    }

    .friends-42-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .friends-42-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid #ddd;
      flex-shrink: 0;
      background: #e0e0e0;
    }

    .friends-42-status-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 999px;
      background: #e0e0e0;
      color: #333;
      max-width: 120px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    .friends-42-status-online {
      background: #d4f7df;
      color: #1b7a3c;
      border: 1px solid #9ae2b6;
    }

    .friends-42-status-offline {
      background: #f9d6d6;
      color: #9b1c1c;
      border: 1px solid #f0a3a3;
    }

    .friends-42-link {
      color: #00babc;
      text-decoration: none;
      font-weight: 500;
      font-size: 16px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      max-width: 120px;
    }

    .friends-42-link:hover {
      text-decoration: underline;
    }

    .friends-42-remove {
      background: transparent;
      border: none;
      cursor: pointer;
      color: #ff5c5c;
      font-size: 14px;
      margin-left: 8px;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
    }

    .friends-42-remove:hover {
      color: #ff7777;
    }

    .friends-42-empty {
      font-size: 12px;
      color: #aaa;
      font-style: italic;
      padding-top: 2px;
    }
  `;
  document.head.appendChild(style);

  const form = panel.querySelector("#friends-42-form");
  const input = panel.querySelector("#friends-42-input");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const login = input.value.trim();
    if (!login) return;
    addFriend(login);
    input.value = "";
  });

  return panel;
}

// ---------- Gestion de la liste ----------
async function addFriend(login) {
  let friends = await loadFriends();
  const exists = friends.some((f) => f.toLowerCase() === login.toLowerCase());
  if (exists) return;
  friends.push(login);
  await saveFriends(friends);
  renderFriendsList();
}

async function removeFriend(login) {
  let friends = await loadFriends();
  friends = friends.filter((f) => f.toLowerCase() !== login.toLowerCase());
  await saveFriends(friends);
  renderFriendsList();
}

// ---------- Rendu de la liste (avatar + bulle de status) ----------
async function renderFriendsList() {
  const friends = await loadFriends();
  const listContainer = document.querySelector("#friends-42-list");
  if (!listContainer) return;

  listContainer.innerHTML = "";

  if (friends.length === 0) {
    const empty = document.createElement("div");
    empty.className = "friends-42-empty";
    empty.textContent = "Aucun ami ajouté pour l’instant.";
    listContainer.appendChild(empty);
    return;
  }

  friends.forEach((login) => {
    const item = document.createElement("div");
    item.className = "friends-42-item";

    const main = document.createElement("div");
    main.className = "friends-42-main";

    const avatar = document.createElement("img");
    avatar.className = "friends-42-avatar";
    avatar.alt = login;
    avatar.referrerPolicy = "no-referrer";

    const statusBadge = document.createElement("span");
    statusBadge.className = "friends-42-status-badge";
    statusBadge.textContent = "…"; // affichage temporaire

    const link = document.createElement("a");
    link.className = "friends-42-link";
    link.href = BASE_PROFILE_URL + encodeURIComponent(login);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = login;

    main.appendChild(avatar);
    main.appendChild(statusBadge);
    main.appendChild(link);

    const removeBtn = document.createElement("button");
    removeBtn.className = "friends-42-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Supprimer des amis";
    removeBtn.addEventListener("click", () => {
      removeFriend(login);
    });

    item.appendChild(main);
    item.appendChild(removeBtn);
    listContainer.appendChild(item);

    // Chargement asynchrone avatar + status
    ensureProfileInfo(login, avatar, statusBadge);

    avatar.addEventListener("error", () => {
      avatar.style.display = "none";
    });
  });
}

// ---------- Insertion dans la grille ----------
async function insertFriendsPanel() {
  // On attend qu'au moins un rectangle blanc soit présent
  const firstCardInner = await waitForElement(".container-inner-item.boxed");
  if (!firstCardInner) {
    console.warn("[42 Friends] Impossible de trouver les blocs de la home.");
    return;
  }

  // On remonte à la colonne (col-lg-4 col-md-6 col-xs-12 fixed-height)
  const firstCol = firstCardInner.parentElement;
  const row = firstCol.closest(".row") || firstCol.parentElement;

  if (!row) {
    console.warn("[42 Friends] Impossible de trouver la .row contenant les blocs.");
    return;
  }

  // On crée une nouvelle colonne avec les mêmes classes que les autres
  const newCol = document.createElement("div");
  newCol.className = firstCol.className;

  const panel = createFriendsPanel();
  newCol.appendChild(panel);

  // On insère notre colonne AVANT la première colonne existante
  row.insertBefore(newCol, firstCol);
  console.log("[42 Friends] Colonne Friends insérée dans la grille.");

  renderFriendsList();
}

// ---------- Init : seulement sur la home ----------
onDomReady(() => {
  console.log("[42 Friends] DOM prêt sur", window.location.href);

  const isHome =
    window.location.origin === "https://profile.intra.42.fr" &&
    (window.location.pathname === "/" || window.location.pathname === "");

  if (!isHome) {
    console.log("[42 Friends] Pas la page d'accueil, panneau non créé.");
    return;
  }

  if (document.querySelector("#friends-42-panel")) {
    renderFriendsList();
  } else {
    insertFriendsPanel();
  }
});
