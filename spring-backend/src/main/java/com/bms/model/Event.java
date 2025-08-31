package com.bms.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;
import lombok.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Document(collection = "events")
@Data // This generates getters, setters, equals, hashCode, toString
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Event {
    @Id
    private String id; // MongoDB uses String IDs by default

    private String title;
    private String category;
    private String imageUrl;
    private String location;

    @Field("event_date")
    private String eventDate;

    @Field("event_time")
    private String eventTime;

    @Field("scraped_at")
    private LocalDateTime scrapedAt;
    private String sourceLink;
    private String price;

    private List<String> description;
    private String additionalDescription;

    // MongoDB naturally supports lists and nested objects
    private List<String> tags;
    private List<String> genres;

    // Additional flexible fields for any scraped data
    private Map<String, Object> additionalData;
}