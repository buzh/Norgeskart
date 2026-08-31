# PocketBase — auth + collections backend for user annotations ("Mine funn").
# Downloads a pinned release straight from the upstream GitHub. No official
# image exists; building it in-repo keeps the supply chain visible.
FROM alpine:3.20

ARG PB_VERSION=0.22.20

RUN apk add --no-cache ca-certificates unzip wget \
  && wget -O /tmp/pb.zip \
       https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
  && unzip /tmp/pb.zip -d /pb \
  && rm /tmp/pb.zip \
  && chmod +x /pb/pocketbase

EXPOSE 8090

# --dir keeps app data (SQLite + uploads) on the mounted volume.
# --migrationsDir loads JS migrations from the repo-mounted directory,
# so schema changes are versioned with the code.
CMD ["/pb/pocketbase", "serve", \
     "--http=0.0.0.0:8090", \
     "--dir=/pb_data", \
     "--migrationsDir=/pb_migrations"]
