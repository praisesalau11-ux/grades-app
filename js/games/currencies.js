
"use strict";

window.GradeFlowCurrencies = (() => {
  const currencies = [
    { code: "NGN", name: "Nigerian naira", symbol: "₦", decimals: 2 },
    { code: "USD", name: "US dollar", symbol: "$", decimals: 2 },
    { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
    { code: "GBP", name: "British pound", symbol: "£", decimals: 2 },
    { code: "JPY", name: "Japanese yen", symbol: "¥", decimals: 0 },
    { code: "CAD", name: "Canadian dollar", symbol: "CA$", decimals: 2 },
    { code: "AUD", name: "Australian dollar", symbol: "A$", decimals: 2 },
    { code: "CHF", name: "Swiss franc", symbol: "CHF", decimals: 2 },
    { code: "CNY", name: "Chinese yuan", symbol: "CN¥", decimals: 2 },
    { code: "SGD", name: "Singapore dollar", symbol: "S$", decimals: 2 },
    { code: "ZAR", name: "South African rand", symbol: "R", decimals: 2 },
    { code: "KES", name: "Kenyan shilling", symbol: "KSh", decimals: 2 },
    { code: "GHS", name: "Ghanaian cedi", symbol: "GH₵", decimals: 2 },
    { code: "INR", name: "Indian rupee", symbol: "₹", decimals: 2 },
    { code: "AED", name: "UAE dirham", symbol: "AED", decimals: 2 },
    { code: "SAR", name: "Saudi riyal", symbol: "SAR", decimals: 2 },
    { code: "NZD", name: "New Zealand dollar", symbol: "NZ$", decimals: 2 },
    { code: "HKD", name: "Hong Kong dollar", symbol: "HK$", decimals: 2 },
    { code: "MXN", name: "Mexican peso", symbol: "MX$", decimals: 2 },
    { code: "BRL", name: "Brazilian real", symbol: "R$", decimals: 2 },
    { code: "SEK", name: "Swedish krona", symbol: "kr", decimals: 2 },
    { code: "NOK", name: "Norwegian krone", symbol: "kr", decimals: 2 },
    { code: "DKK", name: "Danish krone", symbol: "kr", decimals: 2 },
    { code: "PLN", name: "Polish zloty", symbol: "zł", decimals: 2 },
    { code: "TRY", name: "Turkish lira", symbol: "₺", decimals: 2 },
    { code: "IDR", name: "Indonesian rupiah", symbol: "Rp", decimals: 2 },
    { code: "PHP", name: "Philippine peso", symbol: "₱", decimals: 2 },
    { code: "THB", name: "Thai baht", symbol: "฿", decimals: 2 },
    { code: "PKR", name: "Pakistani rupee", symbol: "Rs", decimals: 2 },
    { code: "BDT", name: "Bangladeshi taka", symbol: "৳", decimals: 2 }
  ];

  const byCode = Object.fromEntries(
    currencies.map(currency => [currency.code, currency])
  );

  function get(code) {
    return byCode[String(code || "NGN").toUpperCase()] || byCode.NGN;
  }

  function format(amount, code = "NGN", locale) {
    const currency = get(code);
    const number = Number(amount);

    if (!Number.isFinite(number)) {
      return "—";
    }

    try {
      return new Intl.NumberFormat(
        locale || undefined,
        {
          style: "currency",
          currency: currency.code,
          minimumFractionDigits: currency.decimals,
          maximumFractionDigits: currency.decimals
        }
      ).format(number);
    } catch {
      return `${currency.symbol}${number.toFixed(currency.decimals)}`;
    }
  }

  function populateSelect(select, selectedCode = "NGN") {
    if (!select) return;

    select.replaceChildren();

    currencies.forEach(currency => {
      const option = document.createElement("option");
      option.value = currency.code;
      option.textContent =
        `${currency.code} — ${currency.name} (${currency.symbol})`;
      select.appendChild(option);
    });

    select.value = get(selectedCode).code;
  }

  return Object.freeze({
    list: currencies,
    get,
    format,
    populateSelect
  });
})();
