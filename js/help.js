

const searchInput = document.getElementById("helpSearch");
const clearButton = document.getElementById("clearSearch");
const resetButton = document.getElementById("resetSearch");
const noResults = document.getElementById("noResults");
const searchHint = document.getElementById("searchHint");
const currentYear = document.getElementById("currentYear");

const faqCategories = [
  ...document.querySelectorAll(".faq-category")
];

const faqItems = [
  ...document.querySelectorAll(".faq-item")
];

const categoryCards = [
  ...document.querySelectorAll(".category-card")
];

// Set the current year.
if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}

// Open and close FAQ answers.
faqItems.forEach((item) => {
  const question = item.querySelector(".faq-question");

  if (!question) return;

  question.addEventListener("click", () => {
    const isOpen = item.classList.contains("open");

    // Close other questions.
    faqItems.forEach((otherItem) => {
      otherItem.classList.remove("open");

      const otherQuestion = otherItem.querySelector(".faq-question");

      if (otherQuestion) {
        otherQuestion.setAttribute("aria-expanded", "false");
      }
    });

    // Open the selected question.
    if (!isOpen) {
      item.classList.add("open");
      question.setAttribute("aria-expanded", "true");
    } else {
      question.setAttribute("aria-expanded", "false");
    }
  });
});

// Search through FAQ questions and answers.
function searchFAQs() {
  const searchTerm = searchInput.value
    .trim()
    .toLowerCase();

  let visibleItems = 0;

  clearButton.classList.toggle(
    "visible",
    searchTerm.length > 0
  );

  faqCategories.forEach((category) => {
    const items = [
      ...category.querySelectorAll(".faq-item")
    ];

    let categoryHasResults = false;

    items.forEach((item) => {
      const text = item.textContent.toLowerCase();

      const matches =
        searchTerm === "" || text.includes(searchTerm);

      item.hidden = !matches;

      if (matches) {
        visibleItems++;
        categoryHasResults = true;
      } else {
        item.classList.remove("open");

        const question = item.querySelector(".faq-question");

        if (question) {
          question.setAttribute("aria-expanded", "false");
        }
      }
    });

    category.hidden = !categoryHasResults;
  });

  noResults.hidden = visibleItems !== 0;

  if (searchTerm) {
    searchHint.textContent =
      `${visibleItems} matching question(s) found.`;
  } else {
    searchHint.textContent =
      "Try searching for GPA, password, history or settings.";
  }

  // Clear active category selection after a general search.
  categoryCards.forEach((card) => {
    card.classList.remove("active");
  });
}

// Search input.
searchInput.addEventListener("input", searchFAQs);

// Clear search.
clearButton.addEventListener("click", () => {
  searchInput.value = "";
  searchFAQs();
  searchInput.focus();
});

// Reset everything.
resetButton.addEventListener("click", () => {
  searchInput.value = "";

  faqItems.forEach((item) => {
    item.hidden = false;
    item.classList.remove("open");

    const question = item.querySelector(".faq-question");

    if (question) {
      question.setAttribute("aria-expanded", "false");
    }
  });

  faqCategories.forEach((category) => {
    category.hidden = false;
  });

  categoryCards.forEach((card) => {
    card.classList.remove("active");
  });

  noResults.hidden = true;
  clearButton.classList.remove("visible");

  searchHint.textContent =
    "Try searching for GPA, password, history or settings.";
});

// Category shortcuts.
categoryCards.forEach((card) => {
  card.addEventListener("click", () => {
    const selectedCategory = card.dataset.category;

    searchInput.value = "";

    let targetCategory = null;

    faqCategories.forEach((category) => {
      const matches =
        category.dataset.category === selectedCategory;

      category.hidden = !matches;

      if (matches) {
        targetCategory = category;
      }

      category.querySelectorAll(".faq-item").forEach((item) => {
        item.hidden = false;
        item.classList.remove("open");

        const question = item.querySelector(".faq-question");

        if (question) {
          question.setAttribute("aria-expanded", "false");
        }
      });
    });

    categoryCards.forEach((otherCard) => {
      otherCard.classList.toggle(
        "active",
        otherCard === card
      );
    });

    clearButton.classList.remove("visible");
    noResults.hidden = true;

    searchHint.textContent =
      "Showing the selected help category.";

    if (targetCategory) {
      targetCategory.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });
});

// Initial state.
searchFAQs();
