// ----------------------------------------------------------------------------------
//  Zaawansowany Self-Bot "Ptaszunio" do Zarządzania Partnerstwami
//  Wersja: 4.0 // By: .verslugia.
// CopyRight 2025 © Ptaszunio™ - Zakaz udostępniania i edytowania pod siebie, bez zgody.
// ----------------------------------------------------------------------------------

// --- Importy Modułów ---
const { Client, Intents, Permissions } = require('discord.js-selfbot-v13');
const express = require('express');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const basicAuth = require('express-basic-auth');
const http = require('http'); // Potrzebne dla Socket.IO
const { Server } = require("socket.io");
dotenv.config();
const app = express();
const server = http.createServer(app); // Tworzymy serwer HTTP dla Express i Socket.IO
const io = new Server(server); // Inicjalizujemy Socket.IO
const startTime = Date.now();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); 
const recentReminders = new Map(); // channelId => timestamp
const retryReminders = new Map();  // channelId => { name, retryAt }
const recentAdSends = new Map();   // channelId => timestamp
const axios = require('axios'); // <-- Upewnij się, że axios jest tutaj zaimportowany

// --- Logger ---
// --- Przechwytywanie i Emisja Logów przez Socket.IO ---
const liveLogs = [];
const emitLog = (level, message) => {
    // Upewnijmy się, że nie logujemy samych siebie
    if (message.startsWith('Nowy klient połączył się')) return;
    const logEntry = { level, message, timestamp: new Date() };
    liveLogs.push(logEntry);
    if (liveLogs.length > 50) liveLogs.shift();
    io.emit('new_log', logEntry);
};

// --- Ulepszony Logger ---
const Log = {
    debug: (message) => console.log(`\x1b[36m[DEBUG]\x1b[0m ${new Date().toISOString()} | ${message}`),
    info: (message) => { console.log(`\x1b[34m[INFO]\x1b[0m  ${new Date().toISOString()} | ${message}`); emitLog('INFO', message); },
    success: (message) => { console.log(`\x1b[32m[OK]\x1b[0m    ${new Date().toISOString()} | ${message}`); emitLog('OK', message); },
    warn: (message) => { console.log(`\x1b[33m[WARN]\x1b[0m  ${new Date().toISOString()} | ${message}`); emitLog('WARN', message); },
    error: (message, err = '') => { console.error(`\x1b[31m[ERROR]\x1b[0m ${new Date().toISOString()} | ${message}`, err); emitLog('ERROR', String(err) || message); },
};

// --- Konfiguracja ---
const config = {
    ownerId: process.env.OWNER_ID,
    guildId: process.env.GUILD_ID,
    partnerRoleId: process.env.PARTNER_ROLE_ID,
    intervals: { partnershipReminder: 6 * 60 * 1000, advertisement: 11 * 60 * 1000 },
    partnershipCooldown: 7 * 24 * 60 * 60 * 1000,
    adValidation: { maxLength: 2000, minLength: 50, inviteRegex: /(discord\.gg\/|discord\.com\/invite\/)[\w-]{2,}/ },
    defaultSupportInviteCode: "AKQcC242Bw",
};

if (!config.ownerId || !config.guildId || !config.partnerRoleId) {
    Log.error("Krytyczny błąd: Brak OWNER_ID, GUILD_ID lub PARTNER_ROLE_ID w pliku .env.");
    process.exit(1);
}

if (process.env.DASHBOARD_USER && process.env.DASHBOARD_PASS) {
    app.use(basicAuth({
        users: { [process.env.DASHBOARD_USER]: process.env.DASHBOARD_PASS },
        challenge: true, // Pokazuje okienko logowania przeglądarki
        unauthorizedResponse: 'Nieautoryzowany dostęp. Odśwież stronę i spróbuj ponownie.'
    }));
    Log.info('Ochrona hasłem dla dashboardu jest AKTYWNA.');
} else {
    Log.warn('Ochrona hasłem dla dashboardu jest WYŁĄCZONA. Ustaw DASHBOARD_USER i DASHBOARD_PASS w .env, aby ją włączyć.');
}

// --- Baza Danych ---
const dbPath = path.resolve(__dirname, 'bot.db'); // Nowa nazwa bazy
const db = new sqlite3.Database(dbPath, (err) => { /* ... */ });
const dbManager = {
    initialize: () => {
        db.serialize(() => {
            const createTable = (name, schema) => db.run(schema, (err) => { if (err) Log.error(`Błąd tworzenia tabeli ${name}:`, err); else Log.debug(`Tabela ${name} gotowa.`); });
            // ZMIANA W TABELI: dodano messageId i channelId
            createTable('partnerships', `
                CREATE TABLE IF NOT EXISTS partnerships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT,
                    advertisement TEXT,
                    categoryId INTEGER,
                    messageId TEXT,
                    channelId TEXT,
                    timestamp INTEGER
                )
            `); // <--- Upewnij się, że ten blok tekstowy jest dokładnie taki jak tutaj, bez zbędnych spacji po przecinkach!
            createTable('partnership_categories', `CREATE TABLE IF NOT EXISTS partnership_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, channelId TEXT NOT NULL UNIQUE)`);
            createTable('blacklist', `CREATE TABLE IF NOT EXISTS blacklist (userId TEXT PRIMARY KEY, reason TEXT, timestamp INTEGER)`);
            createTable('partnership_reminder_channels', `CREATE TABLE IF NOT EXISTS partnership_reminder_channels (channelId TEXT PRIMARY KEY, serverId TEXT, name TEXT)`);
            createTable('advertisement_channels', `CREATE TABLE IF NOT EXISTS advertisement_channels (channelId TEXT PRIMARY KEY, serverId TEXT, name TEXT)`);
        });
    },
    run: (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { (err) ? reject(err) : resolve(this); })),
    get: (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => { (err) ? reject(err) : resolve(row); })),
    all: (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => { (err) ? reject(err) : resolve(rows); })),
};
dbManager.initialize();

// --- Klient Discord ---
const client = new Client({
    intents: ['GUILDS', 'GUILD_MEMBERS', 'GUILD_MESSAGES', 'DIRECT_MESSAGES'],
    partials: ['CHANNEL'],
    checkUpdate: false
});

// --- Dane w Pamięci ---
const partnershipState = new Map();
const serverAd = `
# ✨ **Wynieś Swój Serwer na Wyższy Poziom z Ptaszunio!** ✨

Potrzebujesz **profesjonalnego bota**, który zautomatyzuje i policzy Twoje partnerstwa, a do tego zaoferuje **unikalny link** i stronę dla Twojego serwera? **Ptaszunio** to odpowiedź!

## Co zyskujesz z Ptaszunio?
- 📊 **Licznik Partnerstw**: Koniec z ręcznym liczeniem! Nasz bot robi to za Ciebie.
- 🔗 **Własny Link**: Otrzymaj darmowy, łatwy do zapamiętania link w domenie \`ptaszunio.site\`.
- 🎨 **Strona WWW**: Profesjonalna strona-wizytówka dla Twojego serwera.

## Dołącz do Elity!
🔗 **[Dodaj Bota](https://discordapp.com/api/oauth2/authorize?client_id=1376962306726039572&permissions=8)**
🌐 **[Odwiedź Naszą Stronę](https://ptaszunio.site/)**
💬 **[Serwer Wsparcia](https://discord.gg/AKQcC242Bw)**

🏆 **Ptaszunio – Twój klucz do sukcesu na Discordzie!** 🏆
`;

// Powyżej daj swoją reklamę.

async function sendDM(recipient, content) {
    try {
        const user = typeof recipient === 'string' ? await client.users.fetch(recipient) : recipient;
        if (!user) { Log.error(`sendDM: Nie udało się znaleźć użytkownika o ID ${recipient}`); return false; }
        await user.send(content);
        return true;
    } catch (error) {
        if (error.code === 50007) Log.warn(`sendDM: Nie można wysłać DM do ${recipient.tag || recipient.id}.`);
        else Log.error(`sendDM: Błąd podczas wysyłania DM:`, error);
        return false;
    }
}

function validateAdvertisement(ad) {
    if (typeof ad !== 'string') return 'Reklama musi być tekstem.';
    if (ad.trim().length < config.adValidation.minLength) return `Reklama jest za krótka. Minimum ${config.adValidation.minLength} znaków.`;
    if (ad.length > config.adValidation.maxLength) return `Reklama jest za długa. Maksimum ${config.adValidation.maxLength} znaków.`;
    if (!config.adValidation.inviteRegex.test(ad)) return 'Reklama musi zawierać link zaproszenia Discord.';
    return null;
}



async function sendBlacklistLog(messageContent) {
    if (!process.env.BLACKLIST_LOG_CHANNEL_ID) {

        Log.debug("Brak BLACKLIST_LOG_CHANNEL_ID w konfiguracji. Pomijam wysyłanie logu na kanał.");
        return;
    }
    try {
        const channel = await client.channels.fetch(process.env.BLACKLIST_LOG_CHANNEL_ID);
        if (channel && channel.isText()) {
            await channel.send(messageContent);
            Log.info(`Wysłano log black/unblacklist do kanału ${channel.name} (${process.env.BLACKLIST_LOG_CHANNEL_ID}).`);
        } else {
            Log.warn(`Nie udało się znaleźć kanału logów blacklisty (${process.env.BLACKLIST_LOG_CHANNEL_ID}) lub nie jest to kanał tekstowy.`);
        }
    } catch (error) {
        Log.error(`Błąd podczas wysyłania logu blacklisty na kanał (${process.env.BLACKLIST_LOG_CHANNEL_ID}):`, error);
    }
}
// --- Funkcje Pomocnicze ---
// Ta sekcja została zduplikowana, usuwamy ją poniżej.
/*
async function sendDM(recipient, content) {
    try {
        const user = typeof recipient === 'string' ? await client.users.fetch(recipient) : recipient;
        if (!user) { Log.error(`sendDM: Nie udało się znaleźć użytkownika o ID ${recipient}`); return false; }
        await user.send(content);
        return true;
    } catch (error) {
        if (error.code === 50007) Log.warn(`sendDM: Nie można wysłać DM do ${recipient.tag || recipient.id}.`);
        else Log.error(`sendDM: Błąd podczas wysyłania DM:`, error);
        return false;
    }
}

function validateAdvertisement(ad) {
    if (typeof ad !== 'string') return 'Reklama musi być tekstem.';
    if (ad.trim().length < config.adValidation.minLength) return `Reklama jest za krótka. Minimum ${config.adValidation.minLength} znaków.`;
    if (ad.length > config.adValidation.maxLength) return `Reklama jest za długa. Maksimum ${config.adValidation.maxLength} znaków.`;
    if (!config.adValidation.inviteRegex.test(ad)) return 'Reklama musi zawierać link zaproszenia Discord.';
    return null;
}
*/

// --- Główna Logika ---
client.once('ready', async () => {
    Log.success(`${client.user.tag} jest online i gotowy do pracy!`);
    client.user.setActivity('partnerstwa', { type: 'WATCHING' });
    
    Log.info('Uruchamiam cykliczne zadania (przypomnienia i reklamy)...');

    // URUCHOM ZADANIA JEDEN RAZ OD RAZU PO STARCIE
    Log.info('Wykonuję pierwsze uruchomienie zadań po starcie bota...');
    await runPartnershipReminder();
    await runAdvertisementSender();

    // A NASTĘPNIE USTAW PĘTLĘ NA PRZYSZŁOŚĆ
    Log.info('Ustawiam interwały dla przyszłych cykli.');
    setInterval(runPartnershipReminder, config.intervals.partnershipReminder);
    setInterval(runAdvertisementSender, config.intervals.advertisement);
});

async function runPartnershipReminder() {
    Log.info("Uruchamiam cykl przypomnień o partnerstwach...");

    try {
        const channels = await dbManager.all('SELECT * FROM partnership_reminder_channels');
        Log.debug(`[DEBUG] Znaleziono ${channels.length} kanałów przypomnień`);

        if (channels.length === 0) {
            Log.info("Brak kanałów do wysyłania przypomnień. Cykl pominięty.");
            return;
        }

        const reminderMessage = `>>> 👋 **Szukasz partnerów?**\nNapisz do mnie prywatną wiadomość, aby nawiązać zautomatyzowane partnerstwo!`;
        const now = Date.now();
        const cooldown = config.intervals.partnershipReminder;

        // Funkcja pomocnicza do timeoutu
        const withTimeout = (promise, ms, errorMsg) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
        ]);

        for (const { channelId, name } of channels) {
            try {
                Log.debug(`[DEBUG] Rozpoczynam przetwarzanie kanału "${name}" (${channelId})`);

                // Weryfikacja channelId
                if (typeof channelId !== 'string' || !/^\d{17,19}$/.test(channelId)) {
                    Log.warn(`[WARN] Nieprawidłowy channelId "${channelId}" dla kanału "${name}". Pomijam.`);
                    continue;
                }

                // Sprawdzenie cooldownu
                Log.debug(`[DEBUG] Sprawdzam cooldown dla "${name}" (${channelId})`);
                const lastSent = recentReminders.get(channelId);
                if (lastSent) {
                    const elapsed = now - lastSent;
                    const remaining = cooldown - elapsed;
                    if (remaining > 0) {
                        Log.debug(`[POMINIĘTO] ${name} (${channelId}) – cooldown ${Math.ceil(remaining / 1000)}s. Dodaję do kolejki retry.`);
                        retryReminders.set(channelId, { name, retryAt: now + remaining });
                        continue;
                    }
                }
                Log.debug(`[DEBUG] Brak cooldownu dla "${name}" (${channelId})`);

                // Pobieranie kanału
                Log.debug(`[DEBUG] Pobieram kanał "${name}" (${channelId})`);
                let channel;
                try {
                    channel = await withTimeout(
                        client.channels.fetch(channelId),
                        5000,
                        `Timeout podczas pobierania kanału "${name}" (${channelId})`
                    );
                } catch (err) {
                    Log.warn(`[WARN] Nie udało się pobrać kanału "${name}" (${channelId}): ${err.message}`);
                    continue;
                }

                // Sprawdzenie typu kanału
                if (!channel.isText()) {
                    Log.warn(`[WARN] Kanał "${name}" (${channelId}) nie jest kanałem tekstowym. Pomijam.`);
                    continue;
                }

                // Sprawdzenie uprawnień
                Log.debug(`[DEBUG] Sprawdzam uprawnienia dla "${name}" (${channelId})`);
                if (!channel.permissionsFor(client.user).has(Permissions.FLAGS.SEND_MESSAGES)) {
                    Log.warn(`[WARN] Brak uprawnień do wysyłania wiadomości w kanale "${name}" (${channelId}).`);
                    continue;
                }

                // Wysłanie wiadomości
                Log.debug(`[DEBUG] Wysyłam wiadomość do "${name}" (${channelId})`);
                await withTimeout(
                    channel.send(reminderMessage),
                    5000,
                    `Timeout podczas wysyłania wiadomości do "${name}" (${channelId})`
                );
                recentReminders.set(channelId, now);
                Log.success(`Wysłano przypomnienie do kanału "${name}" (${channelId}).`);
            } catch (err) {
                Log.error(`[ERROR] Błąd przetwarzania kanału "${name}" (${channelId}): ${err.message}`);
                continue;
            }
        }
    } catch (err) {
        Log.error("❌ Błąd krytyczny w runPartnershipReminder:", err);
    }
}

async function runAdvertisementSender() {
    Log.info("Uruchamiam cykl wysyłania reklam..."); // Changed log message

    try {
        const channels = await dbManager.all('SELECT * FROM advertisement_channels');
        Log.debug(`[DEBUG] Znaleziono ${channels.length} kanałów reklamowych`);

        if (channels.length === 0) {
            Log.info("Brak kanałów do wysyłania reklam. Cykl pominięty.");
            return;
        }

        const now = Date.now();
        const cooldown = config.intervals.advertisement;

        // Funkcja pomocnicza do timeoutu (re-using the one from runPartnershipReminder for consistency)
        const withTimeout = (promise, ms, errorMsg) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
        ]);

        for (const { channelId, name } of channels) {
            try {
                Log.debug(`[DEBUG] Rozpoczynam przetwarzanie kanału reklamowego "${name}" (${channelId})`);

                // Weryfikacja channelId
                if (typeof channelId !== 'string' || !/^\d{17,19}$/.test(channelId)) {
                    Log.warn(`[WARN] Nieprawidłowy channelId "${channelId}" dla kanału reklamowego "${name}". Pomijam.`);
                    continue;
                }

                // Sprawdzenie cooldownu
                Log.debug(`[DEBUG] Sprawdzam cooldown dla kanału reklamowego "${name}" (${channelId})`);
                const lastSent = recentAdSends.get(channelId);
                if (lastSent) {
                    const elapsed = now - lastSent;
                    const remaining = cooldown - elapsed;
                    if (remaining > 0) {
                        Log.debug(`[POMINIĘTO] Reklama dla ${name} (${channelId}) – cooldown ${Math.ceil(remaining / 1000)}s. Dodaję do kolejki retry.`);
                        retryAdSends.set(channelId, { name, retryAt: now + remaining }); // Use retryAdSends
                        continue;
                    }
                }
                Log.debug(`[DEBUG] Brak cooldownu dla kanału reklamowego "${name}" (${channelId})`);

                // Pobieranie kanału
                Log.debug(`[DEBUG] Pobieram kanał reklamowy "${name}" (${channelId})`);
                let channel;
                try {
                    channel = await withTimeout(
                        client.channels.fetch(channelId),
                        5000,
                        `Timeout podczas pobierania kanału reklamowego "${name}" (${channelId})`
                    );
                } catch (err) {
                    Log.warn(`[WARN] Nie udało się pobrać kanału reklamowego "${name}" (${channelId}): ${err.message}`);
                    continue;
                }

                // Sprawdzenie typu kanału
                if (!channel.isText()) {
                    Log.warn(`[WARN] Kanał reklamowy "${name}" (${channelId}) nie jest kanałem tekstowym. Pomijam.`);
                    continue;
                }

                // Sprawdzenie uprawnień
                Log.debug(`[DEBUG] Sprawdzam uprawnienia dla kanału reklamowego "${name}" (${channelId})`);
                if (!channel.permissionsFor(client.user).has(Permissions.FLAGS.SEND_MESSAGES)) {
                    Log.warn(`[WARN] Brak uprawnień do wysyłania wiadomości w kanale reklamowym "${name}" (${channelId}).`);
                    continue;
                }

                // Wysłanie wiadomości
                Log.debug(`[DEBUG] Wysyłam reklamę do "${name}" (${channelId})`);
                await withTimeout(
                    channel.send(serverAd),
                    5000,
                    `Timeout podczas wysyłania reklamy do "${name}" (${channelId})`
                );
                recentAdSends.set(channelId, now);
                Log.success(`Reklama wysłana do kanału "${name}" (${channelId}).`);
            } catch (err) {
                Log.error(`[ERROR] Błąd przetwarzania kanału reklamowego "${name}" (${channelId}): ${err.message}`);
                continue;
            }
        }
    } catch (err) {
        Log.error("❌ Błąd krytyczny w runAdvertisementSender:", err);
    }
}

client.on('messageCreate', async (message) => {
    if (message.channel.type === 'DM' && !message.author.bot && message.author.id !== client.user.id) {
        if (message.author.id === config.ownerId) {
            if (await handleOwnerCommands(message)) return;
        }
        await handlePartnershipProcess(message);
    }
});

async function handleOwnerCommands(message) {
    if (!message.content.startsWith('!')) return false;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- Oryginalne komendy do zarządzania kanałami reklamowymi ---
    if (command === 'addchannel') {
        if (args.length < 3) return sendDM(message.author, `>>> ⚡ **Błąd!** Użycie: \`!addchannel <serverId> <channelId> <name>\``);
        const [serverId, channelId, ...nameArgs] = args;
        const name = nameArgs.join(' ');
        try {
            await dbManager.run('INSERT OR REPLACE INTO advertisement_channels (channelId, serverId, name) VALUES (?, ?, ?)', [channelId, serverId, name]);
            await sendDM(message.author, `>>> ✅ Dodano kanał reklamowy: **${name}** (\`${channelId}\`)`);
        } catch (error) {
            await sendDM(message.author, `>>> ❌ Błąd dodawania kanału reklamowego: ${error.message}`);
        }
        return true;
    }

    if (command === 'removechannel') {
        if (args.length !== 1) return sendDM(message.author, `>>> ⚡ **Błąd!** Użycie: \`!removechannel <channelId>\``);
        const [channelId] = args;
        const result = await dbManager.run('DELETE FROM advertisement_channels WHERE channelId = ?', [channelId]);
        if (result.changes > 0) await sendDM(message.author, `>>> ✅ Usunięto kanał reklamowy: \`${channelId}\``);
        else await sendDM(message.author, `>>> ❌ Nie znaleziono takiego kanału na liście reklam.`);
        return true;
    }

    if (command === 'listchannels') {
        const channels = await dbManager.all('SELECT * FROM advertisement_channels');
        const list = channels.map(ch => `- ${ch.name}: \`${ch.channelId}\` (Serwer: \`${ch.serverId}\`)`).join('\n') || 'Brak kanałów reklamowych.';
        await sendDM(message.author, `>>> 📋 **Lista Kanałów Reklamowych**\n${list}`);
        return true;
    }

    // --- Oryginalne komendy do zarządzania kanałami przypomnień ---
    if (command === 'addpartnerchannel') {
        if (args.length < 3) return sendDM(message.author, `>>> ⚡ **Błąd!** Użycie: \`!addpartnerchannel <serverId> <channelId> <name>\``);
        const [serverId, channelId, ...nameArgs] = args;
        const name = nameArgs.join(' ');
        try {
            await dbManager.run('INSERT OR REPLACE INTO partnership_reminder_channels (channelId, serverId, name) VALUES (?, ?, ?)', [channelId, serverId, name]);
            await sendDM(message.author, `>>> ✅ Dodano kanał przypomnień: **${name}** (\`${channelId}\`)`);
        } catch (error) {
            await sendDM(message.author, `>>> ❌ Błąd dodawania kanału przypomnień: ${error.message}`);
        }
        return true;
    }

    if (command === 'removepartnerchannel') {
        if (args.length !== 1) return sendDM(message.author, `>>> ⚡ **Błąd!** Użycie: \`!removepartnerchannel <channelId>\``);
        const [channelId] = args;
        const result = await dbManager.run('DELETE FROM partnership_reminder_channels WHERE channelId = ?', [channelId]);
        if (result.changes > 0) await sendDM(message.author, `>>> ✅ Usunięto kanał przypomnień: \`${channelId}\``);
        else await sendDM(message.author, `>>> ❌ Nie znaleziono takiego kanału na liście przypomnień.`);
        return true;
    }

    if (command === 'listpartnerchannels') {
        const channels = await dbManager.all('SELECT * FROM partnership_reminder_channels');
        const list = channels.map(ch => `- ${ch.name}: \`${ch.channelId}\` (Serwer: \`${ch.serverId}\`)`).join('\n') || 'Brak kanałów przypomnień.';
        await sendDM(message.author, `>>> 📋 **Lista Kanałów Przypomnień Partnerstw**\n${list}`);
        return true;
    }

    // --- Komendy do zarządzania KATEGORIAMI ---
    if (command === 'addcategory') {
        const [channelId, ...nameParts] = args;
        const name = nameParts.join(' ');
        if (!/^\d{17,19}$/.test(channelId) || !name) return sendDM(message.author, '>>> Użycie: `!addcategory <ID_kanału> <Nazwa Kategorii>`');
        try {
            await dbManager.run('INSERT INTO partnership_categories (name, channelId) VALUES (?, ?)', [name, channelId]);
            await sendDM(message.author, `>>> ✅ Dodano kategorię **${name}** powiązaną z kanałem \`${channelId}\`.`);
        } catch (err) {
            await sendDM(message.author, `>>> ❌ Błąd! Ten kanał jest już prawdopodobnie przypisany.`);
        }
        return true;
    }
    if (command === 'removecategory') {
        const id = parseInt(args[0]);
        if (isNaN(id)) return sendDM(message.author, '>>> Użycie: `!removecategory <ID_kategorii>`');
        const result = await dbManager.run('DELETE FROM partnership_categories WHERE id = ?', [id]);
        if (result.changes > 0) await sendDM(message.author, `>>> ✅ Usunięto kategorię o ID **${id}**.`);
        else await sendDM(message.author, `>>> ❌ Nie znaleziono kategorii o takim ID.`);
        return true;
    }
    if (command === 'listcategories') {
        const categories = await dbManager.all('SELECT * FROM partnership_categories ORDER BY id');
        const list = categories.map(c => `**${c.id}**. ${c.name} -> <#${c.channelId}>`).join('\n') || 'Brak zdefiniowanych kategorii.';
        await sendDM(message.author, `>>> 📋 **Lista Kategorii Partnerstw**\n${list}`);
        return true;
    }
    
    // --- Pozostałe komendy ---
    if (command === 'blacklist') {
        const userId = args[0];
        const reason = args.slice(1).join(' ') || 'Brak powodu.';
        if (!/^\d{17,19}$/.test(userId)) return sendDM(message.author, '>>> Użycie: `!blacklist <ID_użytkownika> [powód]`');
        try {
            await dbManager.run('INSERT INTO blacklist (userId, reason, timestamp) VALUES (?, ?, ?)', [userId, reason, Date.now()]);
            await sendDM(message.author, `>>> ✅ Użytkownik \`${userId}\` dodany do czarnej listy.`);
            // Wysyłanie logu na kanał
            const userTag = client.users.cache.get(userId)?.tag || 'Nieznany Użytkownik'; // Próba pobrania tagu
            await sendBlacklistLog(`>>> ❌ Użytkownik **<@!${userId}>** (\`${userId}\`) został dodany do czarnej listy.\nPowód: **${reason}**\nPrzez: **${message.author.tag}**`); // <--- DODANO
        } catch (error) {
            await sendDM(message.author, '>>> ❌ Ten użytkownik jest już na czarnej liście.');
        }
        return true;
    }
    if (command === 'unblacklist') {
        const userId = args[0];
        if (!/^\d{17,19}$/.test(userId)) return sendDM(message.author, '>>> Użycie: `!unblacklist <ID_użytkownika>`');
        const result = await dbManager.run('DELETE FROM blacklist WHERE userId = ?', [userId]);
        if (result.changes > 0) {
            await sendDM(message.author, `>>> ✅ Użytkownik \`${userId}\` usunięty z czarnej listy.`);
            // Wysyłanie logu na kanał
            await sendBlacklistLog(`>>> ✅ Użytkownik **<@!${userId}>** (\`${userId}\`) został usunięty z czarnej listy.\nPrzez: **${message.author.tag}**`); // <--- DODANO
        } else {
            await sendDM(message.author, '>>> ❌ Tego użytkownika nie ma na czarnej liście.');
        }
        return true;
    }
    if (command === 'status') {
        const type = args.shift()?.toLowerCase();
        const text = args.join(' ');
        const activityTypes = { playing: 'PLAYING', watching: 'WATCHING', listening: 'LISTENING', streaming: 'STREAMING' };
        if (type === 'clear') {
            await client.user.setActivity(null);
            return sendDM(message.author, '>>> ✅ Status wyczyszczony.');
        }
        if (!activityTypes[type] || !text) return sendDM(message.author, '>>> Użycie: `!status <typ> <tekst>`\nTypy: `playing`, `watching`, `listening`, `streaming`, `clear`.');
        try {
            await client.user.setActivity(text, { type: activityTypes[type] });
            await sendDM(message.author, `>>> ✅ Status ustawiony na: **${type.toUpperCase()}** "${text}"`);
        } catch(e) {
            await sendDM(message.author, '>>> ❌ Błąd ustawiania statusu.');
        }
        return true;
    }
    if (command === 'setcooldown') {
        const days = parseInt(args[0]);
        if (isNaN(days) || days < 0) return sendDM(message.author, '>>> Użycie: `!setcooldown <liczba_dni>`');
        config.partnershipCooldown = days * 24 * 60 * 60 * 1000;
        await sendDM(message.author, `>>> ✅ Nowy cooldown partnerstw: **${days} dni**.`);
        return true;
    }
    if (command === 'getstats') {
        const userId = args[0];
        if (userId) {
            const row = await dbManager.get('SELECT COUNT(*) as count, MAX(timestamp) as last FROM partnerships WHERE userId = ?', [userId]);
            const lastDate = row.last ? new Date(row.last).toLocaleString('pl-PL') : 'Nigdy';
            await sendDM(message.author, `>>> 📊 **Statystyki dla \`${userId}\`**:\n- Partnerstwa: **${row.count}**\n- Ostatnie: **${lastDate}**`);
        } else {
            const row = await dbManager.get('SELECT COUNT(*) as total, COUNT(DISTINCT userId) as unique_users FROM partnerships');
            await sendDM(message.author, `>>> 📈 **Ogólne Statystyki**:\n- Wszystkie partnerstwa: **${row.total}**\n- Unikalni partnerzy: **${row.unique_users}**`);
        }
        return true;
    }
    
    return false;
}

client.on('guildMemberRemove', async (member) => {
    // Sprawdź, czy członek opuścił nasz główny serwer
    if (member.guild.id !== config.guildId) return;

    try {
        // Sprawdź, czy ten użytkownik kiedykolwiek zawarł z nami partnerstwo
        const userPartnerships = await dbManager.all('SELECT * FROM partnerships WHERE userId = ?', [member.id]);

        if (userPartnerships.length === 0) {
            // Ten użytkownik nie był partnerem, ignorujemy.
            return;
        }

        Log.warn(`Partner ${member.user.tag} (${member.id}) opuścił serwer. Rozpoczynam czyszczenie...`);
        let deletedCount = 0;

        for (const partnership of userPartnerships) {
            try {
                const channel = await client.channels.fetch(partnership.channelId);
                const message = await channel.messages.fetch(partnership.messageId);
                await message.delete();
                deletedCount++;
                Log.info(`Usunięto wiadomość z reklamą (${partnership.messageId}) z kanału ${channel.name}.`);
            } catch (err) {
                // Ignorujemy błędy (np. wiadomość już usunięta, brak dostępu do kanału)
                Log.warn(`Nie udało się usunąć wiadomości ${partnership.messageId}: ${err.message}`);
            }
        }

        // Po usunięciu wszystkich wiadomości, czyścimy jego wpisy w bazie
        await dbManager.run('DELETE FROM partnerships WHERE userId = ?', [member.id]);

        const logMessage = `>>> 🧹 **Automatyczne Czyszczenie**\nUżytkownik **${member.user.tag}** opuścił serwer.\nUsunięto **${deletedCount}** jego reklam partnerskich oraz wyczyszczono jego dane z bazy.`;
        await sendDM(config.ownerId, logMessage);
        Log.success(`Zakończono czyszczenie danych dla ${member.user.tag}. Usunięto ${deletedCount} reklam.`);

    } catch (error) {
        Log.error(`Błąd w handlerze guildMemberRemove dla ${member.user.tag}:`, error);
    }
});

async function isValidDiscordInvite(inviteLink) {
    try {
        const inviteCodeMatch = inviteLink.match(/(discord\.gg\/|discord\.com\/invite\/)([\w-]{2,})/);
        if (!inviteCodeMatch || !inviteCodeMatch[2]) {
            Log.warn(`Nieprawidłowy format linku zaproszenia: ${inviteLink}`);
            return false;
        }
        const inviteCode = inviteCodeMatch[2];
        
        // Używamy API Discorda do pobierania informacji o zaproszeniu
        // Należy pamiętać, że to zapytanie jest wykonywane przez bota i może być monitorowane przez Discord.
        const response = await axios.get(`https://discord.com/api/v9/invites/${inviteCode}?with_counts=true`, {
            headers: {
                'Authorization': `Bot ${client.token}` // W przypadku self-bota, używamy tokenu self-bota
            }
        });

        // Jeśli odpowiedź jest OK i zawiera channel_id, to zaproszenie jest zazwyczaj ważne.
        // Możemy również sprawdzić, czy 'guild' lub 'channel' są obecne.
        if (response.status === 200 && response.data && response.data.code === inviteCode) {
            // Dodatkowe sprawdzenia, jeśli chcesz:
            // if (response.data.uses >= response.data.max_uses) return false; // Jeśli osiągnięto maksymalne użycia
            // if (response.data.temporary && !response.data.members.some(m => m.id === client.user.id)) return false; // Tymczasowe zaproszenie
            
            Log.debug(`Link zaproszenia ${inviteLink} jest prawidłowy.`);
            return true;
        }
        return false;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            Log.warn(`Link zaproszenia ${inviteLink} nie istnieje lub wygasł (404 Not Found).`);
            return false;
        }
        if (error.response && error.response.status === 401) {
            Log.error(`Błąd autoryzacji podczas sprawdzania zaproszenia. Sprawdź TOKEN bota!`);
            return false;
        }
        Log.error(`Błąd podczas sprawdzania linku zaproszenia ${inviteLink}:`, error.message);
        return false;
    }
}
async function handlePartnershipProcess(message) { // <-- Upewnij się, że ta linia jest async
    const userState = partnershipState.get(message.author.id);
    if (!userState) {
        const blacklisted = await dbManager.get('SELECT * FROM blacklist WHERE userId = ?', [message.author.id]);
        if (blacklisted) return sendDM(message.author, `>>> ❌ Jesteś na czarnej liście. Powód: *${blacklisted.reason}*`);
        
        const lastPartnership = await dbManager.get('SELECT MAX(timestamp) as last FROM partnerships WHERE userId = ?', [message.author.id]);
        if (lastPartnership && lastPartnership.last && (Date.now() - lastPartnership.last < config.partnershipCooldown)) {
            const remainingDays = Math.ceil((config.partnershipCooldown - (Date.now() - lastPartnership.last)) / (1000 * 60 * 60 * 24));
            return sendDM(message.author, `>>> ⏳ Masz cooldown! Kolejne partnerstwo za ok. **${remainingDays} dni**.`);
        }

        // --- POCZĄTEK ZMODYFIKOWANEGO BLOKU ---
        // Weryfikacja, czy użytkownik jest na serwerze ZANIM rozpocznie się proces.
        try {
            const guild = await client.guilds.fetch(config.guildId);
            if (!guild) {
                 Log.error(`Nie można znaleźć serwera głównego o ID: ${config.guildId}. Sprawdź konfigurację.`);
                 return sendDM(message.author, ">>> ❗️ Wystąpił błąd po naszej stronie. Skontaktuj się z administracją.");
            }
            const member = await guild.members.fetch(message.author.id).catch(() => null);
            if (!member) {
                // Użytkownika nie ma na serwerze. Informujemy go i przerywamy.
                return sendDM(message.author, `>>> ⚠️ **Zanim zaczniemy, musisz dołączyć na nasz serwer!**\n\nPo dołączeniu, napisz do mnie ponownie, aby rozpocząć proces partnerstwa.\n\n🔗 **Dołącz tutaj:** https://discord.gg/qhR4BE633c`);
            }
        } catch (error) {
            Log.error('Błąd podczas sprawdzania czy użytkownik jest na serwerze:', error);
            return sendDM(message.author, ">>> ❗️ Wystąpił błąd podczas weryfikacji. Skontaktuj się z administracją.");
        }
        
        partnershipState.set(message.author.id, { step: 'awaiting_ad' });
        const sent = await sendDM(message.author, `>>> 👋 **Witaj w Systemie Partnerstw!**\nAby rozpocząć, wklej treść swojej reklamy.`);
        if (!sent) partnershipState.delete(message.author.id);
        return;
    }
    switch (userState.step) {
        case 'awaiting_ad':
            const validationError = validateAdvertisement(message.content);
            if (validationError) {
                return sendDM(message.author, `>>> ❌ **Błąd Reklamy!**\n*${validationError}*`);
            }
            
            // --- NOWA WALIDACJA 1: Sprawdzenie, czy reklama nie jest identyczna z domyślną ---
            if (message.content.trim() === serverAd.trim()) {
                return sendDM(message.author, `>>> ❌ **Błąd Reklamy!**\nTwoja reklama nie może być identyczna z naszą domyślną reklamą. Wklej swoją unikalną reklamę.`);
            }

            // Walidacja 2: Sprawdzenie ważności linku zaproszenia Discord
            const userInviteMatch = message.content.match(config.adValidation.inviteRegex);
            if (userInviteMatch && userInviteMatch[0]) {
                const userInviteLink = userInviteMatch[0];
                const userInviteCode = userInviteMatch[2]; // Pobierz kod zaproszenia użytkownika

                // NOWA WALIDACJA 3: Sprawdzenie, czy link użytkownika nie jest linkiem bota
                // Używamy bezpośrednio kodu zaproszenia z konfiguracji
                if (config.defaultSupportInviteCode && userInviteCode === config.defaultSupportInviteCode) {
                    return sendDM(message.author, `>>> ❌ **Błąd Reklamy!**\nNie możesz użyć naszego linku zaproszenia do swojego partnerstwa. Wklej reklamę ze swoim unikalnym linkiem do serwera.`);
                }

                const isValid = await isValidDiscordInvite(userInviteLink);
                if (!isValid) {
                    return sendDM(message.author, `>>> ❌ **Błąd Reklamy!**\nWygląda na to, że link zaproszenia w Twojej reklamie jest nieprawidłowy lub wygasł. Sprawdź go i spróbuj ponownie.`);
                }
            } else {
                // To powinno być już wyłapane przez validateAdvertisement, ale dla pewności
                return sendDM(message.author, '>>> ❌ **Błąd Reklamy!**\nReklama musi zawierać poprawny link zaproszenia Discord.');
            }
            // --- KONIEC NOWYCH WALIDACJI ---
            
            userState.ad = message.content;
            userState.step = 'awaiting_confirmation';
            await sendDM(message.author, `>>> ✅ **Reklama Zapisana!**\nOto nasza reklama do wstawienia:`);
            await sendDM(message.author, serverAd);
            await sendDM(message.author, `>>> ❓ **Potwierdzenie**\nGdy wstawisz naszą reklamę, napisz **"gotowe"**.`);
            break;
        case 'awaiting_confirmation':
            if (!message.content.toLowerCase().includes('gotowe')) return sendDM(message.author, '>>> Czekam, aż napiszesz "gotowe"...');
            const categories = await dbManager.all('SELECT * FROM partnership_categories ORDER BY id');
            if (categories.length === 0) {
                await sendDM(config.ownerId, "🚨 BŁĄD: Ktoś chce partnerstwa, ale nie ma żadnych kategorii! Użyj `!addcategory`.");
                return sendDM(message.author, ">>> ❌ Wystąpił błąd konfiguracji. Spróbuj później.");
            }
            userState.categories = categories;
            userState.step = 'awaiting_category';
            const categoryList = categories.map((c, i) => `**${i + 1}.** ${c.name}`).join('\n');
            await sendDM(message.author, `>>> 📊 **Wybierz Kategorię**\nWpisz numer kategorii, która pasuje do Twojego serwera:\n\n${categoryList}`);
            break;
        case 'awaiting_category':
            const choice = parseInt(message.content) - 1;
            const chosenCategory = userState.categories[choice];
            if (!chosenCategory) return sendDM(message.author, ">>> ❌ Nieprawidłowy numer. Wybierz numer z listy.");
            
            await finalizePartnership(message.author, userState.ad, chosenCategory);
            partnershipState.delete(message.author.id);
            break;
    }
}

async function finalizePartnership(user, userAd, category) {
    try {
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) throw new Error(`Nie znaleziono serwera głównego: ${config.guildId}`);
        const channel = guild.channels.cache.get(category.channelId);
        if (!channel) throw new Error(`Nie znaleziono kanału dla kategorii: ${category.name}`);
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return sendDM(user, `>>> Musisz być na naszym serwerze, aby sfinalizować partnerstwo!`);
        
        const partnershipMessage = `>>> 🤝 **Nowe Partnerstwo w Kategorii: ${category.name}**
**Partner:** ${user.tag} (<@${user.id}>)
**Data:** ${new Date().toLocaleString('pl-PL')}
---
${userAd}`;
        
        // Poprawka: przechwytywanie wyniku channel.send
        const sentMessage = await channel.send(partnershipMessage);
        
        // Zapis do bazy danych z użyciem sentMessage
        await dbManager.run(
            'INSERT INTO partnerships (userId, advertisement, categoryId, messageId, channelId, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
            [user.id, userAd, category.id, sentMessage.id, sentMessage.channel.id, Date.now()]
        );
        
        try {
            const role = guild.roles.cache.get(config.partnerRoleId);
            if (role && guild.me.permissions.has(Permissions.FLAGS.MANAGE_ROLES)) {
                await member.roles.add(role);
                Log.success(`Nadano rolę "${role.name}" użytkownikowi ${user.tag}.`);
            } else if (!role) Log.warn(`Nie znaleziono roli partnera o ID ${config.partnerRoleId}.`);
            else Log.warn(`Brak uprawnień do nadawania ról.`);
        } catch (roleError) {
            Log.error(`Błąd podczas nadawania roli ${user.tag}:`, roleError);
        }
        
        await sendDM(user, `>>> 🎉 **Partnerstwo Sfinalizowane!**\nTwoja reklama została opublikowana. Otrzymałeś specjalną rolę na naszym serwerze. Dziękujemy!`);
        Log.success(`Sfinalizowano partnerstwo z ${user.tag} w kategorii ${category.name}.`);
    } catch (error) {
        Log.error('Krytyczny błąd podczas finalizacji:', error);
        await sendDM(user, '>>> ❗️ Wystąpił błąd po naszej stronie. Skontaktuj się z administracją.');
    }
}

// --- Serwer HTTP i Obsługa Błędów ---
// Endpoint do odświeżania statystyk
app.get('/api/stats', async (req, res) => {
    try {
        const [totalPartnerships, uniquePartners] = await Promise.all([
            dbManager.get('SELECT COUNT(*) as count FROM partnerships'),
            dbManager.get('SELECT COUNT(DISTINCT userId) as count FROM partnerships')
        ]);
        const uptimeMillis = Date.now() - startTime;
        const days = Math.floor(uptimeMillis / (1000 * 60 * 60 * 24));
        const hours = Math.floor((uptimeMillis % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((uptimeMillis % (1000 * 60 * 60)) / (1000 * 60));
        res.json({
            bot: { uptime: `${days}d ${hours}g ${minutes}m` },
            stats: {
                activePartnerships: partnershipState.size,
                totalPartnerships: totalPartnerships.count,
                uniquePartners: uniquePartners.count,
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

app.get('/manage/categories', async (req, res) => {
    try {
        const items = await dbManager.all('SELECT id as item_id, name, channelId FROM partnership_categories ORDER BY name');
        res.render('manage', {
            title: 'Zarządzaj Kategoriami Partnerstw',
            items: items.map(i => ({ id: i.channelId, name: i.name })),
            addAction: '/manage/categories/add',
            deleteAction: '/manage/categories/delete',
            placeholders: { id: 'ID Kanału', name: 'Nazwa Kategorii' },
            headers: { id: 'ID Kanału', name: 'Nazwa Kategorii' }
        });
    } catch (e) { res.status(500).send('Błąd serwera'); }
});
app.post('/manage/categories/add', async (req, res) => {
    try {
        await dbManager.run('INSERT INTO partnership_categories (channelId, name) VALUES (?, ?)', [req.body.id, req.body.name]);
    } catch(e){ Log.error("Błąd dodawania kategorii:", e); }
    res.redirect('/manage/categories');
});
app.post('/manage/categories/delete', async (req, res) => {
    try {
        await dbManager.run('DELETE FROM partnership_categories WHERE channelId = ?', [req.body.id]);
    } catch(e){ Log.error("Błąd usuwania kategorii:", e); }
    res.redirect('/manage/categories');
});

// --- Zarządzanie Kanałami Reklamowymi ---
app.get('/manage/ad-channels', async (req, res) => {
    try {
        const items = await dbManager.all('SELECT * FROM advertisement_channels ORDER BY name');
        res.render('manage', {
            title: 'Zarządzaj Kanałami Reklamowymi',
            items: items.map(i => ({ id: i.channelId, name: i.name, serverId: i.serverId })),
            addAction: '/manage/ad-channels/add',
            deleteAction: '/manage/ad-channels/delete',
            placeholders: { id: 'ID Kanału', name: 'Przyjazna Nazwa' },
            headers: { id: 'ID Kanału', name: 'Nazwa', server: 'ID Serwera' }
        });
    } catch (e) { res.status(500).send('Błąd serwera'); }
});
app.post('/manage/ad-channels/add', async (req, res) => {
    try {
        const { id, name, serverId } = req.body;
        await dbManager.run('INSERT OR REPLACE INTO advertisement_channels (channelId, serverId, name) VALUES (?, ?, ?)', [id, serverId, name]);
    } catch(e){ Log.error("Błąd dodawania kanału reklam:", e); }
    res.redirect('/manage/ad-channels');
});
app.post('/manage/ad-channels/delete', async (req, res) => {
    try {
        await dbManager.run('DELETE FROM advertisement_channels WHERE channelId = ?', [req.body.id]);
    } catch(e){ Log.error("Błąd usuwania kanału reklam:", e); }
    res.redirect('/manage/ad-channels');
});

// --- Zarządzanie Kanałami Przypomnień ---
app.get('/manage/rem-channels', async (req, res) => {
    try {
        const items = await dbManager.all('SELECT * FROM partnership_reminder_channels ORDER BY name');
        res.render('manage', {
            title: 'Zarządzaj Kanałami Przypomnień',
            items: items.map(i => ({ id: i.channelId, name: i.name, serverId: i.serverId })),
            addAction: '/manage/rem-channels/add',
            deleteAction: '/manage/rem-channels/delete',
            placeholders: { id: 'ID Kanału', name: 'Przyjazna Nazwa' },
            headers: { id: 'ID Kanału', name: 'Nazwa', server: 'ID Serwera' }
        });
    } catch (e) { res.status(500).send('Błąd serwera'); }
});
app.post('/manage/rem-channels/add', async (req, res) => {
    try {
        const { id, name, serverId } = req.body;
        await dbManager.run('INSERT OR REPLACE INTO partnership_reminder_channels (channelId, serverId, name) VALUES (?, ?, ?)', [id, serverId, name]);
    } catch(e){ Log.error("Błąd dodawania kanału przypomnień:", e); }
    res.redirect('/manage/rem-channels');
});
app.post('/manage/rem-channels/delete', async (req, res) => {
    try {
        await dbManager.run('DELETE FROM partnership_reminder_channels WHERE channelId = ?', [req.body.id]);
    } catch(e){ Log.error("Błąd usuwania kanału przypomnień:", e); }
    res.redirect('/manage/rem-channels');
});



app.get('/', async (req, res) => {
    try {
        const [totalPartnerships, uniquePartners, categoryCount, blacklistCount, reminderChannels, adChannels] = await Promise.all([
            dbManager.get('SELECT COUNT(*) as count FROM partnerships'),
            dbManager.get('SELECT COUNT(DISTINCT userId) as count FROM partnerships'),
            dbManager.get('SELECT COUNT(*) as count FROM partnership_categories'),
            dbManager.get('SELECT COUNT(*) as count FROM blacklist'),
            dbManager.get('SELECT COUNT(*) as count FROM partnership_reminder_channels'),
            dbManager.get('SELECT COUNT(*) as count FROM advertisement_channels')
        ]);

        const mainGuild = await client.guilds.fetch(config.guildId).catch(() => null);
        const partnerRole = mainGuild ? await mainGuild.roles.fetch(config.partnerRoleId).catch(() => null) : null;

        const uptimeMillis = Date.now() - startTime;
        const days = Math.floor(uptimeMillis / (1000 * 60 * 60 * 24));
        const hours = Math.floor((uptimeMillis % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((uptimeMillis % (1000 * 60 * 60)) / (1000 * 60));
        
        const today = new Date();
        const labels = [];
        const dataPoints = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            labels.push(d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric' }));
            const startOfDay = new Date(d.setHours(0, 0, 0, 0)).getTime();
            const endOfDay = new Date(d.setHours(23, 59, 59, 999)).getTime();
            const dailyCount = await dbManager.get('SELECT COUNT(*) as count FROM partnerships WHERE timestamp >= ? AND timestamp <= ?', [startOfDay, endOfDay]);
            dataPoints.push(dailyCount.count);
        }

        const data = {
            bot: {
                tag: client.user.tag,
                id: client.user.id,
                avatar: client.user.displayAvatarURL(),
                uptime: `${days}d ${hours}g ${minutes}m`
            },
            stats: {
                activePartnerships: partnershipState.size,
                totalPartnerships: totalPartnerships.count,
                uniquePartners: uniquePartners.count,
                categoryCount: categoryCount.count,
                blacklistCount: blacklistCount.count,
            },
            config: {
                cooldownDays: config.partnershipCooldown / (1000 * 60 * 60 * 24),
                partnerRoleName: partnerRole ? `@${partnerRole.name}` : 'Nie znaleziono!',
                reminderChannels: reminderChannels.count,
                adChannels: adChannels.count,
            },
            chartData: {
                labels: labels,
                data: dataPoints
            }
        };

        res.render('dashboard', data);
    } catch (error) {
        Log.error("Błąd podczas generowania dashboardu:", error);
        res.status(500).send("Wystąpił błąd podczas ładowania panelu. Sprawdź logi bota.");
    }
});

io.on('connection', (socket) => {
    // Używamy Log.info, aby zobaczyć to w konsoli bota ORAZ na innych, już podłączonych dashboardach
    Log.info(`Nowy klient połączył się z dashboardem (ID: ${socket.id})`);
    
    // Wyślij historię logów TYLKO do tego jednego, nowo połączonego klienta
    socket.emit('initial_logs', liveLogs);
});


server.listen(process.env.PORT || 4444, () => {
    Log.success(`Serwer HTTP i Socket.IO nasłuchują na porcie ${process.env.PORT || 4444}. Dashboard dostępny!`);
});;
client.on('error', (error) => Log.error('Błąd klienta Discord:', error));
process.on('unhandledRejection', (error) => Log.error('Niezłapany błąd Promise:', error));
process.on('uncaughtException', (error) => { Log.error('Niezłapany wyjątek:', error); process.exit(1); });
process.on('SIGINT', () => {
    Log.info('Zamykanie...');
    client.destroy();
    db.close((err) => {
        if (err) Log.error('Błąd zamykania bazy danych:', err);
        else Log.success('Baza danych zamknięta.');
        process.exit(0);
    });
});

// --- Logowanie ---
client.login(process.env.DISCORD_TOKEN).catch(err => {
    Log.error('Błąd logowania! Sprawdź swój token w pliku .env.', err);
    process.exit(1);
});