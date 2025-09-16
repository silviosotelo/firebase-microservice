# 📁 Estructura del Microservicio Firebase

```
firebase-microservice/
├── 📄 package.json
├── 📄 docker-compose.yml
├── 📄 Dockerfile
├── 📄 ecosystem.config.js          # PM2 config
├── 📄 .env.example
├── 📄 README.md
├── 📄 app.js                       # Entry point
├── 📁 src/
│   ├── 📁 config/
│   │   ├── 📄 database.js          # SQLite config
│   │   ├── 📄 firebase.js          # Firebase config
│   │   ├── 📄 websocket.js         # WebSocket config
│   │   └── 📄 index.js
│   ├── 📁 controllers/
│   │   ├── 📄 notificationController.js
│   │   ├── 📄 statsController.js
│   │   ├── 📄 configController.js
│   │   └── 📄 healthController.js
│   ├── 📁 services/
│   │   ├── 📄 firebaseService.js   # Firebase API logic
│   │   ├── 📄 notificationService.js
│   │   ├── 📄 queueService.js      # Queue management
│   │   ├── 📄 websocketService.js  # Real-time updates
│   │   └── 📄 statsService.js
│   ├── 📁 models/
│   │   ├── 📄 notification.js
│   │   ├── 📄 response.js
│   │   ├── 📄 config.js
│   │   └── 📄 index.js
│   ├── 📁 routes/
│   │   ├── 📄 api.js               # API routes
│   │   ├── 📄 notifications.js
│   │   ├── 📄 admin.js             # Admin routes
│   │   └── 📄 webhooks.js          # Firebase webhooks
│   ├── 📁 middleware/
│   │   ├── 📄 auth.js              # Authentication
│   │   ├── 📄 validation.js        # Request validation
│   │   ├── 📄 rateLimit.js         # Rate limiting
│   │   ├── 📄 errorHandler.js      # Error handling
│   │   └── 📄 logger.js            # Request logging
│   ├── 📁 utils/
│   │   ├── 📄 logger.js            # Winston logger
│   │   ├── 📄 validators.js        # Data validators
│   │   ├── 📄 helpers.js           # Helper functions
│   │   └── 📄 constants.js         # App constants
│   └── 📁 websockets/
│       ├── 📄 handlers.js          # WebSocket handlers
│       └── 📄 events.js            # WebSocket events
├── 📁 public/
│   ├── 📄 index.html               # Landing page
│   ├── 📁 admin/
│   │   ├── 📄 index.html           # Admin dashboard
│   │   ├── 📄 notifications.html   # Notification manager
│   │   ├── 📄 stats.html           # Stats dashboard
│   │   ├── 📄 config.html          # Configuration
│   │   └── 📄 logs.html            # Logs viewer
│   ├── 📁 assets/
│   │   ├── 📁 css/
│   │   ├── 📁 js/
│   │   └── 📁 images/
│   └── 📁 docs/
│       ├── 📄 api-docs.html        # Swagger UI
│       └── 📄 integration.html     # Integration guide
├── 📁 tests/
│   ├── 📁 unit/
│   ├── 📁 integration/
│   └── 📁 fixtures/
├── 📁 docs/
│   ├── 📄 API.md
│   ├── 📄 DEPLOYMENT.md
│   └── 📄 INTEGRATION.md
└── 📁 database/
    ├── 📄 init.sql                 # Initial schema
    └── 📁 migrations/
        └── 📄 001_initial_schema.sql
```