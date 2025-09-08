package com.bms.controller;

import com.bms.model.Event;
import com.bms.repository.EventRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/scrape")
public class ScrapeController {

    private static final Logger logger = LoggerFactory.getLogger(ScrapeController.class);

    private final EventRepository eventRepo;

    public ScrapeController(EventRepository eventRepo) {
        this.eventRepo = eventRepo;
    }

    @PostMapping("/district")
    @Scheduled(cron = "0 0 0 * * ?") // Every day at 12:00 am
    public ResponseEntity<?> scrapeBookMyShow() {
        try {
            List<Event> allEvents = new ArrayList<>();
            ObjectMapper mapper = new ObjectMapper();
            mapper.registerModule(new JavaTimeModule());

            // Start both scraping services in parallel
            CompletableFuture<Void> service3000Task = CompletableFuture.runAsync(() -> {
                try {
                    String response3000 = callScrapingService("http://localhost:3000/scrape", "{\"baseUrl\": \"https://www.district.in\"}");
                    if (response3000 != null && !response3000.isEmpty()) {
                        List<Event> events3000 = processScrapedData(response3000, mapper, "service-3000");
                        // Save immediately when service 3000 completes
                        eventRepo.saveAll(events3000);
                        System.out.println("✅ Service 3000 completed and saved " + events3000.size() + " events");
                        allEvents.addAll(events3000);
                    }
                } catch (Exception e) {
                    System.err.println("❌ Service 3000 failed: " + e.getMessage());
                }
            });

            CompletableFuture<Void> service3001Task = CompletableFuture.runAsync(() -> {
                try {
                    String response3001 = callScrapingService("http://localhost:3001/scrape", "{\"baseUrl\": \"https://www.district.in\"}");
                    if (response3001 != null && !response3001.isEmpty()) {
                        List<Event> events3001 = processScrapedData(response3001, mapper, "service-3001");
                        // Save immediately when service 3001 completes
                        eventRepo.saveAll(events3001);
                        System.out.println("✅ Service 3001 completed and saved " + events3001.size() + " events");
                        allEvents.addAll(events3001);
                    }
                } catch (Exception e) {
                    System.err.println("❌ Service 3001 failed: " + e.getMessage());
                }
            });

            // Wait for both services to complete
            CompletableFuture<Void> allServices = CompletableFuture.allOf(service3000Task, service3001Task);
            allServices.join(); // Wait for completion

            return ResponseEntity.ok("✅ Scraping completed! Total events saved: " + allEvents.size() +
                    " from both services. Data was saved progressively as each service completed.");

        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("❌ Error: " + e.getMessage());
        }
    }

    private String callScrapingService(String serviceUrl, String payload) {
        try {
            URL url = new URL(serviceUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(30000); // 30 seconds to establish connection
            conn.setReadTimeout(14400000); // 4 hours (4 * 60 * 60 * 1000ms) - very generous for scraping

            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload.getBytes());
            }

            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder responseSB = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) responseSB.append(line);
            in.close();

            return responseSB.toString();
        } catch (Exception e) {
            System.err.println("Error calling " + serviceUrl + ": " + e.getMessage());
            return null; // Return null if service fails
        }
    }

    private List<Event> processScrapedData(String jsonResponse, ObjectMapper mapper, String source) {
        try {
            List<Map<String, Object>> rawList = mapper.readValue(jsonResponse, new TypeReference<>() {});
            List<Event> eventList = new ArrayList<>();

            for (Map<String, Object> raw : rawList) {
                Event event = new Event();
                event.setTitle((String) raw.get("title"));
                event.setCategory((String) raw.get("category"));
                event.setLocation((String) raw.get("location"));
                event.setImageUrl((String) raw.get("image"));

                String dateStr = (String) raw.get("eventDate");
                try {
                    if (dateStr != null && !"TBD".equalsIgnoreCase(dateStr)) {
                        event.setEventDate(dateStr);
                    } else {
                        event.setEventDate(null);
                    }
                } catch (Exception ex) {
                    System.out.println("error in event date: " + ex);
                    event.setEventDate(null);
                }

                if (raw.get("eventTime") != null) {
                    event.setEventTime((String) raw.get("eventTime"));
                } else {
                    event.setEventTime(null);
                }

                if (raw.get("eventLink") != null) {
                    event.setSourceLink((String) raw.get("eventLink"));
                } else {
                    event.setSourceLink(null);
                }

                if (raw.get("price") != null) {
                    event.setPrice((String) raw.get("price"));
                } else {
                    event.setPrice(null);
                }

                event.setScrapedAt(LocalDateTime.now());

                if (raw.get("description") != null) {
                    event.setDescription((List<String> )raw.get("description"));
                } else {
                    event.setDescription(null);
                }

                if (raw.get("tags") != null) {
                    event.setTags((List<String>) raw.get("tags"));
                } else {
                    event.setTags(null);
                }

                if (raw.get("genres") != null) {
                    event.setGenres((List<String>) raw.get("genres"));
                } else {
                    event.setGenres(null);
                }

                // Store additional data with source information
                Map<String, Object> additionalData = new HashMap<>(raw);
                additionalData.remove("title");
                additionalData.remove("category");
                additionalData.remove("location");
                additionalData.remove("image");
                additionalData.remove("eventDate");
                additionalData.remove("eventTime");
                additionalData.remove("eventLink");
                additionalData.remove("price");
                additionalData.remove("description");
                additionalData.remove("tags");
                additionalData.remove("genres");

                // Add source information to track which service provided the data
                additionalData.put("scrapingSource", source);

                event.setAdditionalData(additionalData);
                eventList.add(event);
            }

            return eventList;
        } catch (Exception e) {
            System.err.println("Error processing data from " + source + ": " + e.getMessage());
            return new ArrayList<>();
        }
    }

    // New MongoDB-specific endpoints
    @GetMapping("/events")
    public ResponseEntity<List<Event>> getAllEvents() {
        List<Event> events = eventRepo.findAll();
        return ResponseEntity.ok(events);
    }

    @GetMapping("/events/category/{category}")
    public ResponseEntity<List<Event>> getEventsByCategory(@PathVariable String category) {
        List<Event> events = eventRepo.findByCategory(category);
        return ResponseEntity.ok(events);
    }

    @GetMapping("/events/location/{location}")
    public ResponseEntity<List<Event>> getEventsByLocation(@PathVariable String location) {
        List<Event> events = eventRepo.findByLocation(location);
        return ResponseEntity.ok(events);
    }

    @GetMapping("/events/search")
    public ResponseEntity<List<Event>> searchEvents(@RequestParam String title) {
        List<Event> events = eventRepo.findByTitleContainingIgnoreCase(title);
        return ResponseEntity.ok(events);
    }

    @GetMapping("/events/recent/{hours}")
    public ResponseEntity<List<Event>> getRecentEvents(@PathVariable int hours) {
        LocalDateTime since = LocalDateTime.now().minusHours(hours);
        List<Event> events = eventRepo.findByScrapedAtAfter(since);
        return ResponseEntity.ok(events);
    }

//    8 sept 2025 00:00

    @PostMapping("/events/flexible")
    public ResponseEntity<Event> saveFlexibleEvent(@RequestBody Map<String, Object> eventData) {
        Event event = Event.builder()
                .title((String) eventData.get("title"))
                .category((String) eventData.get("category"))
                .location((String) eventData.get("location"))
                .imageUrl((String) eventData.get("imageUrl"))
                .eventDate((String) eventData.get("eventDate"))
                .eventTime((String) eventData.get("eventTime"))
                .price((String) eventData.get("price"))
                .sourceLink((String) eventData.get("sourceLink"))
                .scrapedAt(LocalDateTime.now())
                .additionalData(eventData) // Store the entire payload
                .build();

        Event savedEvent = eventRepo.save(event);
        return ResponseEntity.ok(savedEvent);
    }

    @GetMapping("/events/scrapedAt")
    public ResponseEntity<?> getEventsBasedOnScrapedAt(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) String lastScrapedAt
    ) {
        try {
            LocalDateTime parsedDate = LocalDateTime.parse(lastScrapedAt);
            List<Event> events = eventRepo.findByScrapedAtAfter(parsedDate);
            logger.info("Fetched {} events scraped after {}", events.size(), lastScrapedAt);
            return ResponseEntity.ok(events);
        } catch (Exception e) {
            logger.error("Invalid lastScrapedAt parameter: {}", lastScrapedAt, e);
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("message", "Invalid 'lastScrapedAt' format. Use ISO_LOCAL_DATE_TIME, e.g. '2024-06-09T12:00:00'");
            errorResponse.put("status", "error");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
        }
    }

}
