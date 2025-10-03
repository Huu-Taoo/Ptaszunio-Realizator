# Ptaszunio-Realizator 🐦

Solidny system do efektywnego zarządzania partnerstwami, tworzenia automatycznych partnerstw. wykorzystujący możliwości pracy w czasie rzeczywistym oraz integrację z Discordem.
Korzystanie z self-botów jest niezgodne z TOS Discorda używasz na własną odpowiedzialność! 

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-Creative_Commons_Zero_v1.0_Universal-green)
![Stars](https://img.shields.io/github/stars/Huu-Taoo/Ptaszunio-Realizator?style=social)
![Forks](https://img.shields.io/github/forks/Huu-Taoo/Ptaszunio-Realizator?style=social)
![Top Language](https://img.shields.io/github/languages/top/Huu-Taoo/Ptaszunio-Realizator)

## ✨ Funkcje

* 🤝 **Zarządzanie partnerstwami:** Łatwe śledzenie i zarządzanie różnymi partnerstwami Ptaszunio za pomocą dedykowanego interfejsu webowego.
* 💬 **Integracja z Discordem:** Powiadomienia i aktualizacje w czasie rzeczywistym dotyczące zdarzeń partnerskich bezpośrednio na Discordzie, z wykorzystaniem `discord.js`.
* 📊 **Interaktywne panele:** Wizualizacja danych i statystyk dotyczących partnerstw dzięki `Dashboardu`, aby uzyskać przejrzystą analitykę.
* ⚙️ **Bezpieczna konfiguracja:** Obsługa zmiennych środowiskowych (`.env`) dla poufnych informacji i elastycznego wdrażania.


## 🚀 Instrukcja instalacji

Postępuj według poniższych kroków, aby uruchomić Ptaszunio-Realizator na swojej lokalnej maszynie.

### Wymagania wstępne

Upewnij się, że masz zainstalowane:

* [Node.js](https://nodejs.org/en/) (zalecana wersja LTS)
* [npm](https://www.npmjs.com/) (dołączony do Node.js) lub [Yarn](https://yarnpkg.com/)

### Instalacja krok po kroku

1. **Sklonuj repozytorium:**

   ```bash
   git clone https://github.com/Huu-Taoo/Ptaszunio-Realizator.git
   cd Ptaszunio-Realizator
   ```

2. **Zainstaluj zależności:**
   Używając npm:

   ```bash
   npm install
   ```

   Lub używając Yarn:

   ```bash
   yarn install
   ```

3. **Konfiguracja środowiska:**
   Utwórz plik `.env` w katalogu głównym projektu. Ten plik będzie przechowywał Twoje zmienne środowiskowe, takie jak tokeny bota Discord, numery portów i dane do połączenia z bazą danych.

   ```dotenv
   # Przykładowy plik .env
   PORT=3000
   DISCORD_BOT_TOKEN=TWÓJ_TOKEN_BOTA_DISCORD
   # ...
   ```

   * **`PORT`**: Port, na którym uruchomiony będzie serwer [www](http://www).
   * **`DISCORD_BOT_TOKEN`**: Token uwierzytelniający Twojego bota Discord. Kluczowy dla integracji.

4. **Konfiguracja bazy danych (SQLite):**
   Projekt korzysta z `sqlite3`. Plik bazy danych zazwyczaj zostanie utworzony automatycznie przy pierwszym uruchomieniu, ale możliwe, że trzeba będzie go zainicjalizować. Jeśli istnieje specjalny skrypt inicjalizacyjny, uruchom go na tym etapie.
   *(Placeholder dla konkretnych kroków inicjalizacji, np. `npm run db:init`)*

## 💡 Przykłady użycia

Po instalacji i konfiguracji możesz uruchomić aplikację:

1. **Uruchom aplikację:**

   ```bash
   npm start
   ```

   Aplikacja będzie zazwyczaj dostępna przez przeglądarkę pod adresem `http://localhost:3000` (lub wybranym w zmiennej `PORT`).

2. **Dostęp do panelu:**
   Przejdź w przeglądarce na wskazany port. Możesz napotkać prostą autoryzację, jeśli skonfigurowano `express-basic-auth`.
   *(Placeholder: Zrzut ekranu uruchomionego panelu aplikacji.)*
   ![Przykładowy Dashboard](/dashboard_example.png)

3. **Zarządzanie partnerstwami:**
   Korzystaj z interfejsu webowego, aby dodawać nowe partnerstwa, aktualizować istniejące i przeglądać analizy. Powiadomienia Discord będą wysyłane zgodnie z konfiguracją.

## 🗺️ Mapa rozwoju projektu

Planujemy ekscytujące funkcje w przyszłych wersjach Ptaszunio-Realizatora:

* **Wersja 1.1.0:**

  * Rozszerzone uwierzytelnianie użytkowników i kontrola dostępu oparta na rolach.
  * Bardziej konfigurowalne widżety panelu dla konkretnych metryk partnerstwa.
  * Integracja z dodatkowymi platformami komunikacyjnymi (np. Telegram).

* **Przyszłe usprawnienia:**

  * Zaawansowane raportowanie i funkcje eksportu danych o partnerstwach.
  * Kompleksowe API do integracji zewnętrznych.
  * Wsparcie dla aplikacji mobilnych.

## 🤝 Wkład społeczności

Chętnie przyjmujemy wkład społeczności! Aby wnieść swój udział w rozwój Ptaszunio-Realizatora, postępuj według poniższych wytycznych:

* **Fork repozytorium:** Rozpocznij od wykonania forka projektu na swoje konto GitHub.

* **Utwórz gałąź funkcjonalności:** Stwórz nową gałąź dla swojej funkcji lub poprawki:

  ```bash
  git checkout -b feature/nazwa-funkcji
  ```

  Nazwy gałęzi powinny być opisowe (np. `feature/add-discord-auth`, `bugfix/fix-chart-display`).

* **Styl kodu:** Trzymaj się istniejących konwencji. Ogólnie stosujemy standard JavaScript/ESLint.

* **Komunikaty commitów:** Pisz jasne i zwięzłe komunikaty.

  * Rozpoczynaj od typu (feat, fix, chore, docs, style, refactor, test, perf).
  * Przykład: `feat: Dodaj formularz tworzenia partnerstwa`

* **Testowanie:** Upewnij się, że Twoje zmiany są dobrze przetestowane. Jeśli dodajesz nowe funkcje, dodaj także odpowiednie testy.

* **Proces Pull Request:**

  1. Wypchnij swoje zmiany do forka.
  2. Otwórz Pull Request (PR) do gałęzi `main` oryginalnego repozytorium.
  3. Dodaj jasny opis zmian i uzasadnienie.
  4. Odpowiadaj na uwagi maintainerów.


## 📄 Licencja

Ten projekt jest objęty licencją **Creative Commons Zero v1.0 Universal**.

Pełny tekst licencji znajdziesz [tutaj](https://creativecommons.org/publicdomain/zero/1.0/).

**Podsumowanie Creative Commons Zero v1.0 Universal:**
Osoba, która powiązała utwór z tym dokumentem, zrzeka się wszelkich praw autorskich na całym świecie, w maksymalnym zakresie dopuszczalnym przez prawo, w tym praw pokrewnych. Możesz kopiować, modyfikować, rozpowszechniać i wykorzystywać ten utwór, nawet w celach komercyjnych, bez konieczności pytania o zgodę.
