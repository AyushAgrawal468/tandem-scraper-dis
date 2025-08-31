package com.bms.controller;

import com.bms.model.Event;
import com.bms.repository.EventRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/scrape")
public class ScrapeController {

    private final EventRepository eventRepo;

    public ScrapeController(EventRepository eventRepo) {
        this.eventRepo = eventRepo;
    }

    @PostMapping("/district")
    public ResponseEntity<?> scrapeBookMyShow() {
        try {
            URL url = new URL("http://localhost:3000/scrape");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);

            String payload = "{\"baseUrl\": \"https://www.district.in\"}";
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload.getBytes());
            }

            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder responseSB = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) responseSB.append(line);
            in.close();

            ObjectMapper mapper = new ObjectMapper();
            mapper.registerModule(new JavaTimeModule()); // Important!

            // Deserialize JSON into List<Event>
            List<Map<String, Object>> rawList = mapper.readValue(responseSB.toString(), new TypeReference<>() {});
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
                        event.setEventDate(dateStr); // Valid date string
                    } else {
                        event.setEventDate(null); // or set default LocalDate.now() if needed
                    }
                }catch(Exception ex){
                    System.out.println("error in event date"+ex);
                    event.setEventDate(null);
                }
                if(raw.get("eventTime") != null) {
                    event.setEventTime((String) raw.get("eventTime"));
                } else {
                    event.setEventTime(null); // Handle missing time
                }
                if (raw.get("eventLink") != null) {
                    event.setSourceLink((String) raw.get("eventLink"));
                } else {
                    event.setSourceLink(null); // Handle missing link
                }
                if( raw.get("price") != null) {
                    event.setPrice((String) raw.get("price"));
                } else {
                    event.setPrice(null); // Handle missing price
                }
                event.setScrapedAt(LocalDateTime.now());
                if(raw.get("description") != null) {
                    event.setDescription((List<String>) raw.get("description"));
                } else {
                    event.setDescription(null); // Handle missing description
                }
                if(raw.get("tags") != null) {
                    // Cast to List<String> since tags come as an array from Node.js
                    event.setTags((List<String>) raw.get("tags"));
                } else {
                    event.setTags(null); // Handle missing tags
                }
                if(raw.get("genres") != null) {
                    // Cast to List<String> since genres come as an array from Node.js
                    event.setGenres((List<String>) raw.get("genres"));
                } else {
                    event.setGenres(null); // Handle missing genres
                }

                // MongoDB advantage: Store ALL additional data flexibly
                // Remove the already processed fields and store everything else
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

                // Store any additional scraped data that doesn't fit the standard fields
                event.setAdditionalData(additionalData);

                eventList.add(event);
            }


            // Save to DB
            eventRepo.saveAll(eventList);

            return ResponseEntity.ok("✅ Events scraped and saved: " + eventList.size());
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("❌ Error: " + e.getMessage());
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
}