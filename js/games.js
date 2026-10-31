"use strict";

/*
 * GradeFlow Games — central homepage controller
 *
 * Homepage: pages/games.html
 * Styles:   css/games.css
 * Modules:  pages/games/
 *
 * Manages homepage navigation and shared schedule helpers.
 * Individual modules remain responsible for loading and displaying games.
 */

(() => {
  const toast = document.getElementById("gamesToast");
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menuToggle");
  const sidebarOverlay = document.getElementById("sidebarOverlay");

  let toastTimer = null;

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
   * Shared date helpers.
   * Supports Firestore Timestamps, ISO date strings,
   * JavaScript Date objects and millisecond timestamps.
   */

  function getDate(value) {
    if (value == null || value === "") return null;

    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "string") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "object" && value.seconds != null) {
      const date = new Date(Number(value.seconds) * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  /*
   * New and old game creators may use different field names.
   */

  function getScheduledDate(game) {
    if (!game || typeof game !== "object") return null;

    const possibleFields = [
      game.scheduledAt,
      game.startDateTime,
      game.scheduledStart,
      game.startTime,
      game.startDate
    ];

    for (const value of possibleFields) {
      const date = getDate(value);
      if (date) return date;
    }

    return null;
  }

  function getScheduleStatus(game) {
    if (game?.status === "completed") return "completed";
    if (game?.status === "live") return "live";

    const scheduledDate = getScheduledDate(game);

    if (scheduledDate && scheduledDate.getTime() > Date.now()) {
      return "scheduled";
    }

    return "lobby";
  }

  function formatSchedule(game) {
    const date = getScheduledDate(game);

    if (!date) return "Start time not set";

    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function scheduleHasNotPassed(game) {
    const date = getScheduledDate(game);

    return Boolean(date && date.getTime() > Date.now());
  }

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

  function closeSidebar() {
    sidebar?.classList.remove("open");
    sidebarOverlay?.classList.remove("show");
    menuToggle?.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  function toggleSidebar() {
    if (!sidebar) return;

    const isOpen = sidebar.classList.toggle("open");

    sidebarOverlay?.classList.toggle("show", isOpen);
    menuToggle?.setAttribute("aria-expanded", String(isOpen));

    document.body.style.overflow = isOpen ? "hidden" : "";
  }

  menuToggle?.addEventListener("click", toggleSidebar);
  sidebarOverlay?.addEventListener("click", closeSidebar);

  /*
   * Check whether a registered page exists.
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

      if (response.status !== 405 && response.status !== 501) {
        return false;
      }
    } catch (error) {
      // Fall back to GET.
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

  async function checkModulePages() {
    const entries = Object.entries(GAME_MODULES);

    await Promise.all(
      entries.map(async ([moduleId, module]) => {
        const available = await pageExists(module.path);
        updateModuleStatus(moduleId, available);
      })
    );
  }

  async function openModule(moduleId, link) {
    const module = GAME_MODULES[moduleId];

    if (!module) {
      showToast("This Games module has not been registered yet.");
      return;
    }

    link.setAttribute("aria-busy", "true");

    try {
      const available = await pageExists(module.path);

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
        "but its page has not been created yet."
      );
    } finally {
      link.removeAttribute("aria-busy");
    }
  }

  document.querySelectorAll("[data-game-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
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

      openModule(link.dataset.gameRoute, link).catch((error) => {
        console.error("Games navigation error:", error);
        showToast("Could not open this module. Check your connection.");
      });
    });
  });

  document.querySelectorAll(".side-nav .nav-link").forEach((link) => {
    if (link.getAttribute("href") === "games.html") {
      link.classList.add("active");
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      closeSidebar();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  /*
   * Public helpers for other GradeFlow Games scripts.
   */

  window.GradeFlowGames = Object.freeze({
    modules: GAME_MODULES,
    checkModulePages,
    showToast,
    getDate,
    getScheduledDate,
    getScheduleStatus,
    formatSchedule,
    scheduleHasNotPassed
  });

  checkModulePages();

  console.info("GradeFlow Games homepage controller initialized.");
})();