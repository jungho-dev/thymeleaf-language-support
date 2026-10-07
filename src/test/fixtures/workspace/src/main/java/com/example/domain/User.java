package com.example.domain;

import lombok.Data;

/**
 * <pre>
 *
 * 사용자
 *
 * - Lombok getter 기반 프로퍼티
 *
 * </pre>
 */
@Data
public class User {

    private Long id;
    private String name;
    private String email;
}
