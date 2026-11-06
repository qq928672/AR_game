/* Lamby 網站設定（index.html、admin.html、qrcodes.html 共用）
   設定方式請看 GOOGLE-SETUP.md。兩個值都不是密碼，放在公開網站上沒關係。 */
window.LAMBY_CONFIG = {
  // Apps Script 部署後的網址，結尾是 /exec。留空 = 學生端改讀 questions.json（舊方式）
  API_URL: "https://script.google.com/macros/s/AKfycbyeA8gAOlYD2JEgH15S2NAnps6xx1w3rAwUMzbUTWOlf3jdgW04d_W_WV3fpxtfi5Ea/exec",
  // Google Cloud 的 OAuth 用戶端 ID，結尾是 .apps.googleusercontent.com
  GOOGLE_CLIENT_ID: "291083329930-qr3oppa0cs65psds5trpn5q5ht2cemsb.apps.googleusercontent.com"
};
