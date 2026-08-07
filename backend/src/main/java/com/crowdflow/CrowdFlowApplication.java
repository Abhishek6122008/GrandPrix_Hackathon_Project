package com.crowdflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CrowdFlowApplication {

    public static void main(String[] args) {
        SpringApplication.run(CrowdFlowApplication.class, args);
    }
}
