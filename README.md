# Gestione Utenze 2.1 — correzione importazione PDF/AI

Correzioni principali:

- mostra l'errore reale restituito dal Worker Cloudflare;
- evita di salvare `********` come token di sicurezza;
- riconosce più formati di risposta JSON dell'AI;
- controlla se il PDF è una scansione senza testo selezionabile;
- prova un'estrazione locale di base quando l'AI non risponde;
- aggiunge il pulsante “Verifica collegamento AI”;
- aggiorna il service worker per evitare che GitHub Pages continui a caricare il vecchio `app.js`.

Caricare nel repository tutti i file con questi nomi esatti.
