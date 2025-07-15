- setup postgres db (docker run --name pixel_canvas -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=your_password_here -e POSTGRES_DB=pixel_canvas -p 5432:5432 -d postgres)
- setup redis instance (docker run -d --name redis-pixels -p 6378:6379 redis)
- cp env.sample .env
- npm run start:dev:full


### versions
- node: v23.9.0
- nest: 11.0.7
- npm: 10.9.2