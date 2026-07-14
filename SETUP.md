# ABA Schedule Assistant - Setup & Running Guide

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
```bash
cp .env.example .env
```

Edit `.env` and add your Claude API key:
```
CLAUDE_API_KEY=sk-ant-...your-api-key...
```

### 3. Build the Application
```bash
npm run build
```

### 4. Run the Servers

**Option A: Both in one terminal (with concurrency)**
```bash
npm run dev          # Starts backend on port 5000
# In another terminal:
npm run dev:client   # Starts frontend on port 3000 with hot-reload
```

**Option B: Production build**
```bash
npm run build:server
npm start
# Then visit http://localhost:5000 with the served frontend
```

## Features

### Calendar Management
- Month view with color-coded appointments
- Click appointments to select them
- See supervision/parent training requirements
- Fixed appointments marked with red borders

### Conflict Resolution
- Upload Excel file with your schedule
- Constraints validated automatically
- Edit appointment and get conflicts
- Claude AI generates 2-3 alternative solutions
- Apply solutions to update schedule

### Data Management
- **HIPAA-Compliant**: No data stored server-side
- The only export is the encrypted backup (AES-256), named
  `<practiceName>_<date>_<time>.sassi` — plaintext Excel export was removed
- Backups always require a password (policy-checked) to write
- Restore a backup (or import a legacy `.xlsx` / `.enc.json`) via the upload picker

### Admin Panel
- Manage technician RBT certification
- Update client/technician availability
- View company compliance settings
- Create/modify appointments

## Excel File Format

### Upload Format
Your Excel file should have these sheets:

**Clients Sheet**
```
id | name | MondayStart | MondayEnd | ... | FridayStart | FridayEnd | notes
C1 | John |    09:00    |    17:00  | ... |    09:00    |    17:00  | ...
```

**Technicians Sheet**
```
id | name | isRBT | MondayStart | ... | client1 | hours1 | client2 | hours2 | notes
T1 | Sarah| TRUE  |    08:00    | ... |   C1    |  15    |   C2    |   5    | ...
```

**Settings Sheet**
```
supervisionDirectHoursPercent | supervisionRBTHoursPercent | parentTrainingMinimum | ...
5                             | 5                          | 1.5                   | ...
```

**Appointments Sheet**
```
id  | title               | technician | client | startTime              | endTime                | isFixed | isBillable | type              | isRecurring
APT1| Client A Session    | Sarah      | John   | 2025-05-05T09:00:00   | 2025-05-05T12:00:00  | FALSE   | TRUE       | client-session    | TRUE
APT2| Supervision Weekly  | Sarah      |        | 2025-05-06T14:00:00   | 2025-05-06T15:00:00  | FALSE   | FALSE      | supervision       | TRUE
```

Types: `client-session`, `supervision`, `parent-training`, `internal-task`, `other`

### Backup Format
Backups are encrypted envelopes with the `.sassi` extension (legacy
`.enc.json` backups restore identically). Excel is import-only.

**To restore:**
1. Keep the backup password stored securely — it is the file's only key
2. Upload the `.sassi` file through the normal picker
3. Enter the same password when prompted

## Constraints Enforced

### Supervision Requirements (per technician, per month)
- 5% of direct client hours (billable sessions)
- 5% of RBT hours (if RBT certified)

### Parent Training (per month)
- Minimum: 1.5 hours
- Target: 2-4 hours

### Availability
- Respects technician availability windows
- Respects client availability windows
- No scheduling outside availability

### Fixed Appointments
- Marked with `isFixed: TRUE`
- Cannot be moved by conflict resolver
- Only modifiable through Admin panel

## Claude API Integration

The system uses Claude API to generate scheduling solutions when conflicts occur.

### How It Works
1. You modify an appointment
2. System detects conflicts
3. Claude AI asked to generate 2-3 alternative solutions
4. Solutions can span single week or up to end of month
5. Each solution includes reasoning and change list

### Model Used
Default: `claude-opus-4-7`

**To use a different model**, edit `src/claudeScheduler.ts` line 32:
```typescript
// Change from:
model: 'claude-opus-4-7',
// To:
model: 'claude-sonnet-4-6', // or 'claude-haiku-4-5'
```

**Model Recommendations:**
- **Opus 4.7**: Best accuracy for complex multi-week scheduling
- **Sonnet 4.6**: Great balance of quality/speed/cost (recommended)
- **Haiku 4.5**: Acceptable for simple cases, faster responses

## API Endpoints

### Schedule Management
- `POST /api/upload` - Upload Excel file (plain or encrypted)
- `GET /api/schedule` - Get current schedule
- `POST /api/appointment/:id` - Update appointment
- `POST /api/apply-solution` - Apply suggested solution
- `GET /api/encryption-password` - Get encryption password
- `POST /api/encryption-password` - Set new password

### Admin
- `POST /api/admin/technician/:id` - Update technician
- `POST /api/admin/client/:id` - Update client
- `POST /api/admin/appointment` - Create/update appointment

## Troubleshooting

### Claude API Key Not Working
- Verify key is set in `.env`
- Check key is valid on Claude dashboard
- Fallback to algorithmic solution generation (shown in UI)

### Encryption Errors
- Ensure the backup password is stored separately from the file
- On restore, enter the exact same password

### Data Not Persisting
- Changes only persist in server memory (dev-server mode)
- Save a `.sassi` backup (Settings → Data → Backup) to keep your work
- Restore the backup to continue editing

### Port Already in Use
- Change port in `.env` and vite config
- Or kill process using the port:
  ```bash
  lsof -ti :5000 | xargs kill -9
  lsof -ti :3000 | xargs kill -9
  ```

## Architecture Notes

- **Frontend**: React + TypeScript compiled by Vite
- **Backend**: Express.js with TypeScript
- **Data**: Excel (XLSX) with AES-256 encryption
- **AI**: Claude API (async, falls back gracefully)
- **Storage**: Client-side only (HIPAA-compliant)

## Next Steps

1. Set up `.env` with Claude API key
2. Run `npm run dev` for backend
3. Run `npm run dev:client` for frontend (hot-reload)
4. Visit `http://localhost:3000`
5. Upload sample_schedule.xlsx to test
6. Try modifying an appointment to see conflict resolution
7. Save an encrypted `.sassi` backup to keep your work

Enjoy managing your ABA schedules efficiently!
