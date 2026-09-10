# Mirrors .github/workflows/deploy.yml: same Ruby version and Gemfile-driven
# dependencies, so a successful local build/serve here predicts CI results.
FROM ruby:3.2

WORKDIR /srv/app

# Node.js is required by ExecJS (used by kramdown-math-katex) to run KaTeX's
# JS and pre-render LaTeX math to HTML at build time. GitHub Actions'
# ubuntu-latest runners already ship Node.js, so deploy.yml needs no change.
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install gems first so this layer is cached unless Gemfile(.lock) changes.
COPY Gemfile Gemfile.lock ./
RUN gem install bundler && bundle install

# No `COPY . .`: docker-compose.yml bind-mounts the repo over /srv/app at
# runtime, so any code baked in here would be immediately shadowed anyway.
# No CMD/EXPOSE here: runtime command and port are defined per-service in
# docker-compose.yml (this image is only ever run via compose).
