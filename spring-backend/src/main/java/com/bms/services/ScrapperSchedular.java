package com.bms.services;

import com.bms.model.Event;
import com.bms.repository.EventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class ScrapperSchedular {


    private static final Logger log = LoggerFactory.getLogger(ScrapperSchedular.class);
    @Autowired
    private EventRepository eventRepo;


    @Transactional
    @Scheduled(cron = "0 0 4 * * ?")
    public void deleteEventsScrappedBefore5Days() {

        LocalDateTime threshold = LocalDateTime.now().minusDays(5);

        try {
            List<Event> deleteEvents = eventRepo.findByScrapedAtBefore(threshold);

            eventRepo.deleteAll(deleteEvents);

            log.info("Deleted {} events scraped before {}", deleteEvents.size(), threshold);
        } catch (Exception ex) {
            log.error("Failed to delete old scraped events", ex);
        }
    }
}
