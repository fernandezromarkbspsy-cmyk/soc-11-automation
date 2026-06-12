FROM golang:1.23-bookworm AS build

WORKDIR /src

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/seatalk-callback .

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=build /out/seatalk-callback /app/seatalk-callback

EXPOSE 8000

CMD ["/app/seatalk-callback"]
