FROM jekyll/jekyll:pages

WORKDIR /srv/jekyll

# Install webrick for Ruby >= 3
RUN gem install webrick

EXPOSE 4000

CMD ["jekyll", "serve", "--source", "/srv/jekyll/docs", "--watch", "--force_polling", "--host", "0.0.0.0"]
