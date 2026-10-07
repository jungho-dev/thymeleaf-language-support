package com.example.service;

import java.util.List;
import com.example.domain.Item;
import com.example.domain.User;

/**
 * <pre>
 *
 * 항목 서비스
 *
 * - 컨트롤러 타입 추론 대상 메서드 제공
 *
 * </pre>
 */
public interface ItemService {

    List<Item> findAll();

    Item findOne(
        Long id
    );

    User currentUser();
}
