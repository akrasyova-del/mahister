# Satellite Watcher

Система автоматизованого розподілу космічних апаратів між 4 оптичними телескопами України в реальному часі.

## Функціонал

- **4 телескопи** — Київ, Волинь, Житомир, Одеса
- **55 КА** — розвідувальні, метеорологічні, навігаційні супутники РФ
- **Автоматичний розподіл** за weighted score (геометрія + погода + вікно + навантаження)
- **Автоперерозподіл** при відключенні телескопа
- **Пріоритетна черга** — перекинуті КА обробляються першими
- **TLE** — Space-Track.org / CelesTrak / mock / ручне введення
- **Погода** — Open-Meteo API кожні 10 хв
- **WebSocket** — реальний час
- **Карта** — Leaflet + 4 маркери телескопів
- **2D інтерфейс оператора** — панель, таблиці, деталі

## Запуск (без Docker)

### Вимоги
- Python 3.12+
- Node.js 20+

### Backend

```bash
cd backend

# Копіювати конфігурацію
cp .env.example .env

# (Опціонально) Налаштувати Space-Track credentials у .env
# Без них система використовує CelesTrak + mock

# Встановити залежності
pip install -r requirements.txt

# Запустити
uvicorn app.main:app --reload --port 8000
```

Сервер доступний на: http://localhost:8000
Документація API: http://localhost:8000/docs

### Frontend

```bash
cd frontend

npm install
npm run dev
```

Frontend доступний на: http://localhost:5173

### Mock-режим (без зовнішніх API)

У `backend/.env`:
```
MOCK_TLE=true
MOCK_WEATHER=true
```

## API

| Метод | URL | Опис |
|-------|-----|------|
| GET | /api/telescopes | Список телескопів |
| GET | /api/telescopes/{code} | Деталі телескопа |
| PATCH | /api/telescopes/{code}/status | Зміна статусу |
| PATCH | /api/telescopes/{code}/settings | Зміна порогів/координат |
| GET | /api/satellites | Список КА |
| GET | /api/satellites/{norad_id} | Деталі КА |
| POST | /api/tle/update | Оновити TLE |
| GET | /api/tle/status | Статус TLE |
| POST | /api/tle/manual | Ввести TLE вручну |
| POST | /api/weather/update | Оновити погоду |
| GET | /api/weather/telescopes | Погода по телескопах |
| POST | /api/passes/recalculate | Перерахувати прольоти |
| GET | /api/passes | Вікна спостереження |
| GET | /api/assignments/current | Поточний розподіл |
| POST | /api/assignments/recalculate | Перерахувати розподіл |
| POST | /api/assignments/manual | Ручне призначення |
| GET | /api/dashboard/state | Стан панелі |
| GET | /api/events | Журнал подій |
| WS | /ws/dashboard | WebSocket реального часу |

## Алгоритм розподілу

```
score = 0.30 * geometry_score
      + 0.25 * weather_score
      + 0.20 * time_window_score
      + 0.15 * telescope_capability_score
      + 0.10 * load_balance_score

# Перекинуті КА отримують бонус +0.25
```

Телескоп переключається тільки якщо різниця score > 0.15 (стабільність).

## Тести

```bash
cd backend
pytest tests/ -v
```

## Структура проєкту

```
satellite-watcher/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI + scheduler
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/          # SQLAlchemy моделі
│   │   ├── services/        # Бізнес-логіка
│   │   │   ├── assignment_engine.py  # Алгоритм розподілу
│   │   │   ├── orbital_service.py    # skyfield розрахунки
│   │   │   ├── tle_service.py        # Отримання TLE
│   │   │   └── weather_service.py    # Open-Meteo
│   │   ├── api/             # REST endpoints
│   │   ├── websocket/       # WS manager
│   │   └── seed/            # Початкові дані
│   └── tests/
├── frontend/
│   └── src/
│       ├── pages/           # 7 сторінок
│       ├── components/      # Shared компоненти
│       ├── services/        # API + WebSocket клієнти
│       └── types/           # TypeScript типи
├── data/
│   └── satellites.json      # 55 КА
├── CREDENTIALS.md           # Мануал по API ключах
└── README.md
```

## Зовнішні сервіси

Дивіться [CREDENTIALS.md](CREDENTIALS.md) для інструкцій по реєстрації.

| Сервіс | Обов'язковий | Реєстрація |
|--------|-------------|------------|
| Space-Track.org | Ні (є CelesTrak) | Безкоштовно |
| CelesTrak | Ні (є mock) | Не потрібна |
| Open-Meteo | Ні (є mock) | Не потрібна |
