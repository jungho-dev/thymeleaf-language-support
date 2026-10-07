package com.example.domain;

/**
 * <pre>
 *
 * 항목
 *
 * - 명시적 getter 기반 프로퍼티
 *
 * </pre>
 */
public class Item {

    private Long id;
    private String name;
    private boolean active;

    public Item(
        Long id,
        String name,
        boolean active
    ) {
        this.id = id;
        this.name = name;
        this.active = active;
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public boolean isActive() {
        return active;
    }
}
