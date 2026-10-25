
"use strict";

/*
 * GradeFlow Games — central homepage controller
 *
 * Homepage: pages/games.html
 * Styles:   css/games.css
 * Modules:  pages/games/
 *
 * This file manages homepage navigation only.
 * It does not replace individual module controllers.
 */

(() => {
  const toast = document.getElementById("gamesToast");
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menuToggle");
  const sidebarOverlay = document.getElementById("sidebarOverlay");

  let toastTimer = null;

  /*
   * Central module registry.
   *
   * When a module is created, it can use its registered path.
   * The page checker determines whether the destination currently exists.
   */

  const GAME_MODULES = {
    "match-lobby": {
      name: "Match Lobby",
      path: "games/match-lobby.html"
    },

    "live-match": {
      name: "Live Match",
      path: "games/live-match.html"
    },

    "watch-match": {
      name: "Watch Matches",
      path: "games/watch-match.html"
    },

    "my-matches": {
      name: "My Matches",
      path: "games/my-matches.html"
    },

    "games-profile": {
      name: "Games Profile",
      path: "games/games-profile.html"
    },

    "leaderboard": {
      name: "Leaderboard",
      path: "games/leaderboard.html"
    },

    "hall-of-fame": {
      name: "Hall of Fame",
      path: "games/hall-of-fame.html"
    },

    "sponsorships": {
      name: "Sponsorships",
      path: "games/sponsorships.html"
    },

    "games-wallet": {
      name: "Games Wallet",
      path: "games/games-wallet.html"
    },

    "games-search": {
      name: "Games Search",
      path: "games/games-search.html"
    },

    "games-notifications": {
      name: "Games Notifications",
      path: "games/games-notifications.html"
    }
  };

  /*
   * Display a message on the homepage.
   */

  function showToast(message) {
    if (!toast) {
      console.info("[GradeFlow Games]", message);
      return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    window.clearTimeout(toastTimer);

    toastTimer = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 4000);
  }

  /*
   * Close the mobile sidebar.
   */

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove("open");
    }

    if (sidebarOverlay) {
      sidebarOverlay.classList.remove("show");
    }

    if (menuToggle) {
      menuToggle.setAttribute("aria-expanded", "false");
    }

    document.body.style.overflow = "";
  }

  /*
   * Toggle the mobile sidebar.
   */

  function toggleSidebar() {
    if (!sidebar) return;

    const isOpen = sidebar.classList.toggle("open");

    if (sidebarOverlay) {
      sidebarOverlay.classList.toggle("show", isOpen);
    }

    if (menuToggle) {
      menuToggle.setAttribute(
        "aria-expanded",
        String(isOpen)
      );
    }

    document.body.style.overflow = isOpen ? "hidden" : "";
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", toggleSidebar);
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", closeSidebar);
  }

  /*
   * Check whether a registered page exists.
   *
   * HEAD avoids downloading the entire page.
   * GET is used as a fallback if HEAD is not supported.
   */

  async function pageExists(path) {
    const target = new URL(path, window.location.href);

    if (target.origin !== window.location.origin) {
      return false;
    }

    try {
      const response = await fetch(target.href, {
        method: "HEAD",
        cache: "no-store",
        redirect: "follow"
      });

      if (response.ok) return true;

      if (response.status !== 405 &&
          response.status !== 501) {
        return false;
      }
    } catch (error) {
      // Try GET below.
    }

    try {
      const response = await fetch(target.href, {
        method: "GET",
        cache: "no-store",
        redirect: "follow"
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /*
   * Update a module's availability labels.
   */

  function updateModuleStatus(moduleId, available) {
    document
      .querySelectorAll(`[data-game-route="${moduleId}"]`)
      .forEach((element) => {
        const status = element.querySelector(".module-status");

        if (!status) return;

        status.textContent = available ? "Available" : "Coming soon";
        status.classList.toggle("status-ready", available);
        status.classList.toggle("status-planned", !available);
      });
  }

  /*
   * Check registered modules when the homepage loads.
   *
   * This updates the status labels without preventing the page
   * from opening if a network request fails.
   */

  async function checkModulePages() {
    const entries = Object.entries(GAME_MODULES);

    if (entries.length === 0) return;

    await Promise.all(
      entries.map(async ([moduleId, module]) => {
        const available = await pageExists(module.path);
        updateModuleStatus(moduleId, available);
      })
    );
  }

  /*
   * Navigate to a module only if its page exists.
   *
   * Existing pages open normally.
   * Missing pages display a useful message instead of a broken route.
   */

  async function openModule(moduleId, link) {
    const module = GAME_MODULES[moduleId];

    if (!module) {
      showToast("This Games module has not been registered yet.");
      return;
    }

    const originalText = link.dataset.originalText || link.textContent;
    link.dataset.originalText = originalText;
    link.setAttribute("aria-busy", "true");

    const available = await pageExists(module.path);

    link.removeAttribute("aria-busy");

    if (available) {
      const destination = new URL(
        module.path,
        window.location.href
      );

      closeSidebar();
      window.location.assign(destination.href);
      return;
    }

    updateModuleStatus(moduleId, false);

    showToast(
      `${module.name} is registered in GradeFlow Games, ` +
      "but its page has not been created yet. " +
      "You can continue using the available modules."
    );
  }

  /*
   * Connect all sidebar, hero, profile, and module-card links
   * that have a data-game-route attribute.
   */

  document.querySelectorAll("[data-game-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      // Preserve normal browser actions such as opening a new tab.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();

      const moduleId = link.dataset.gameRoute;

      openModule(moduleId, link).catch((error) => {
        console.error("Games navigation error:", error);
        showToast("Could not open this module. Check your connection.");
      });
    });
  });

  /*
   * Mark the homepage Overview link as active.
   */

  document.querySelectorAll(".side-nav .nav-link").forEach((link) => {
    const href = link.getAttribute("href");

    if (href === "games.html") {
      link.classList.add("active");
    }
  });

  /*
   * Keep the interface usable when the browser changes size.
   */

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      closeSidebar();
    }
  });

  /*
   * Allow Escape to close the mobile navigation.
   */

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  /*
   * Public registry for future Games code.
   * Other scripts may inspect the registered routes.
   */

  window.GradeFlowGames = Object.freeze({
    modules: GAME_MODULES,
    checkModulePages,
    showToast
  });

  /*
   * Start the homepage controller.
   */

  checkModulePages();

  console.info("GradeFlow Games homepage controller initialized.");
})();
