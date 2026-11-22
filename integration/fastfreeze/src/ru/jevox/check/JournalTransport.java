package ru.jevox.check;

import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

final class JournalTransport {
    private final HttpClient client;
    private final String token;
    private final URI fallback;
    private URI endpoint;

    JournalTransport(HttpClient client, URI endpoint, URI fallback, String token) {
        this.client = client;
        this.endpoint = endpoint;
        this.fallback = fallback;
        this.token = token;
    }

    URI endpoint() {
        return endpoint;
    }

    HttpResponse<String> post(String json) throws IOException, InterruptedException {
        try {
            return post(endpoint, json);
        } catch (HttpConnectTimeoutException | ConnectException error) {
            // A failed connection could not deliver the request.
            if (fallback == null || endpoint.equals(fallback)) throw error;
            HttpResponse<String> response = post(fallback, json);
            if (response.statusCode() == 200) endpoint = fallback;
            return response;
        }
    }

    private HttpResponse<String> post(URI target, String json) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(target).timeout(Duration.ofSeconds(14))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json)).build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
