package com.bms.repository;

import com.bms.model.Event;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface EventRepository extends MongoRepository<Event, String> {

    // Find by title
    List<Event> findByTitle(String title);

    // Find by category
    List<Event> findByCategory(String category);

    // Find by location
    List<Event> findByLocation(String location);

    // Find events by date
    List<Event> findByEventDate(String eventDate);

    // Find events scraped after a certain time
    List<Event> findByScrapedAtAfter(LocalDateTime dateTime);

    // Find by tags (MongoDB can search within arrays naturally)
    List<Event> findByTagsContaining(String tag);

    // Find by genres
    List<Event> findByGenresContaining(String genre);

    // Custom query to find events by title containing text (case insensitive)
    @Query("{'title': {'$regex': ?0, '$options': 'i'}}")
    List<Event> findByTitleContainingIgnoreCase(String title);

    // Find events by price range (assuming price is stored as string, you might want to convert)
    @Query("{'additionalData.numericPrice': {'$gte': ?0, '$lte': ?1}}")
    List<Event> findByPriceRange(Double minPrice, Double maxPrice);

    // Find events by category and location
    List<Event> findByCategoryAndLocation(String category, String location);

    // Find events with specific additional data field
    @Query("{'additionalData.?0': {'$exists': true}}")
    List<Event> findByAdditionalDataFieldExists(String fieldName);
}