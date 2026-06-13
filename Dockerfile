FROM golang:1.23-bookworm AS build

WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/pdf-to-png-converter ./cmd/pdf-to-png-converter

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils imagemagick \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/pdf-to-png-converter /app/pdf-to-png-converter

ENV PORT=8080 \
    WORK_DIR=/tmp/pdf-to-png-converter

EXPOSE 8080
ENTRYPOINT ["/app/pdf-to-png-converter"]
