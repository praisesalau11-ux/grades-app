/* ==========================================
   GradeFlow 2.0
   File: js/index.js

   Landing Page Controller
   ========================================== */


/* ==========================================
   DOM ELEMENTS
   ========================================== */

const pageLoader =
  document.getElementById("pageLoader");

const heroVisual =
  document.getElementById("heroVisual");

const exploreButton =
  document.getElementById("exploreButton");

const navExplore =
  document.getElementById("navExplore");

const exploreSection =
  document.getElementById("exploreSection");

const currentYear =
  document.getElementById("currentYear");


/* ==========================================
   PAGE INITIALIZATION
   ========================================== */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    initializeLoader();

    initializeNavigation();

    initializeParallax();

    initializeRevealAnimations();

    initializeYear();

  }
);


/* ==========================================
   PAGE LOADER
   ========================================== */

function initializeLoader() {

  /*
   * Give the browser a moment to render
   * the landing page before removing loader.
   */

  window.setTimeout(
    () => {

      if (!pageLoader) {
        return;
      }

      pageLoader.classList.add("hidden");

    },
    850
  );
}


/* ==========================================
   NAVIGATION
   ========================================== */

function initializeNavigation() {

  if (exploreButton) {

    exploreButton.addEventListener(
      "click",
      () => {

        scrollToExplore();

      }
    );

  }


  if (navExplore) {

    navExplore.addEventListener(
      "click",
      () => {

        scrollToExplore();

      }
    );

  }

}


/* ==========================================
   SCROLL TO EXPLORE
   ========================================== */

function scrollToExplore() {

  if (!exploreSection) {
    return;
  }

  exploreSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

}


/* ==========================================
   3D PARALLAX
   ========================================== */

function initializeParallax() {

  if (!heroVisual) {
    return;
  }


  /*
   * Disable heavy parallax on touch devices.
   * The CSS animations still provide movement.
   */

  const isTouchDevice =
    window.matchMedia(
      "(pointer: coarse)"
    ).matches;


  if (isTouchDevice) {
    return;
  }


  const floatingObjects =
    heroVisual.querySelectorAll(
      "[data-depth]"
    );


  let targetX = 0;
  let targetY = 0;

  let currentX = 0;
  let currentY = 0;


  document.addEventListener(
    "mousemove",
    (event) => {

      const rect =
        heroVisual.getBoundingClientRect();


      const centerX =
        rect.left + rect.width / 2;

      const centerY =
        rect.top + rect.height / 2;


      targetX =
        (event.clientX - centerX) /
        rect.width;

      targetY =
        (event.clientY - centerY) /
        rect.height;

    }
  );


  function animateParallax() {

    currentX +=
      (targetX - currentX) * 0.07;

    currentY +=
      (targetY - currentY) * 0.07;


    const rotateY =
      currentX * 7;

    const rotateX =
      currentY * -7;


    heroVisual.style.transform =
      `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;


    floatingObjects.forEach(
      (object) => {

        const depth =
          Number(
            object.dataset.depth
          );


        const moveX =
          currentX * depth;

        const moveY =
          currentY * depth;


        /*
         * We intentionally use CSS variables
         * instead of replacing the object's
         * animation transforms.
         */

        object.style.setProperty(
          "--parallax-x",
          `${moveX}px`
        );

        object.style.setProperty(
          "--parallax-y",
          `${moveY}px`
        );

      }
    );


    requestAnimationFrame(
      animateParallax
    );

  }


  animateParallax();

}


/* ==========================================
   REVEAL ANIMATIONS
   ========================================== */

function initializeRevealAnimations() {

  const elements =
    document.querySelectorAll(
      ".feature-card, .explore-cta"
    );


  if (!elements.length) {
    return;
  }


  elements.forEach(
    (element) => {

      element.classList.add("reveal");

    }
  );


  /*
   * IntersectionObserver keeps the page
   * lightweight and avoids running scroll
   * calculations continuously.
   */

  const observer =
    new IntersectionObserver(
      (entries) => {

        entries.forEach(
          (entry) => {

            if (!entry.isIntersecting) {
              return;
            }

            entry.target.classList.add(
              "visible"
            );

            observer.unobserve(
              entry.target
            );

          }
        );

      },
      {
        threshold: 0.15
      }
    );


  elements.forEach(
    (element) => {

      observer.observe(element);

    }
  );

}


/* ==========================================
   CURRENT YEAR
   ========================================== */

function initializeYear() {

  if (!currentYear) {
    return;
  }

  currentYear.textContent =
    new Date().getFullYear();

}


/* ==========================================
   KEYBOARD ACCESSIBILITY
   ========================================== */

document.addEventListener(
  "keydown",
  (event) => {

    /*
     * Pressing Escape does not navigate away.
     * It simply returns focus to the main page.
     */

    if (event.key === "Escape") {

      document.body.focus();

    }

  }
);


/* ==========================================
   ERROR SAFETY
   ========================================== */

window.addEventListener(
  "error",
  (event) => {

    /*
     * Do not expose technical errors
     * directly to the user.
     *
     * Firebase/auth errors will be handled
     * by their respective pages later.
     */

    console.warn(
      "GradeFlow page error:",
      event.message
    );

  }
);