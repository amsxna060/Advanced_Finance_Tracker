"""
Smart expense categorization service.

Uses keyword / pattern matching to suggest expense categories from descriptions.
Category names are aligned exactly with the DB seed (migration 017_categories).
No external API calls — works offline, zero cost, zero latency.
"""

import re
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# Canonical parent categories (must match DB category names exactly)
# ─────────────────────────────────────────────────────────────────────────────
# Ordered by specificity: check more specific patterns before general ones.
CATEGORY_RULES: dict[str, list[str]] = {
    "Groceries & Daily Needs": [
        r"\bvegetables?\b", r"\bsabzi\b", r"\bfruits?\b",
        r"\bration\b", r"\bkirana\b",
        r"\bdmart\b", r"\bbigbasket\b", r"\bzepto\b",
        r"\bblinkit\b", r"\binstamart\b", r"\bswiggy\s*instamart\b",
        r"\bmilk\b", r"\bdairy\b", r"\beggs?\b", r"\bcurd\b", r"\byogurt\b",
        r"\batta\b", r"\brice\b", r"\bdal\b", r"\bflour\b",
        r"\bspices?\b", r"\boil\b.*cook", r"\bcooking\s*oil\b",
        r"\bsugar\b", r"\bsalt\b",
        r"\bgrocery\b", r"\bgrocer\b",
        r"\bdetergent\b", r"\bsabun\b", r"\btissues?\b",
        r"\btoilet\s*paper\b",
    ],
    "Housing & Utilities": [
        r"\brent\b", r"\bhouse\s*rent\b", r"\bflat\s*rent\b",
        r"\broom\s*rent\b", r"\bpg\b.*rent", r"\brent\b.*pg",
        r"\bemi\b", r"\bhome\s*loan\b",
        r"\belectricity\b", r"\belectric\s*bill\b",
        r"\bwater\s*bill\b", r"\bbill\s*water\b",
        r"\bgas\s*bill\b", r"\bcylinder\b", r"\blpg\b",
        r"\bbill\s*gas\b",
        r"\bwifi\b", r"\binternet\b", r"\bbroadband\b",
        r"\bairtel\b.*fiber", r"\bjio\b.*fiber", r"\bact\b.*broadband",
        r"\bdth\b", r"\bcable\s*tv\b", r"\bdish\s*tv\b",
        r"\btata\s*sky\b", r"\bsociety\s*maintenance\b",
        r"\bsociety\b.*charge", r"\bmaintenance\s*charge\b",
        r"\bpaint\b.*house", r"\bhouse\b.*paint",
        r"\brenovation\b", r"\bplumber\b", r"\belectrician\b",
        r"\bcarpenter\b", r"\bhome\s*repair\b",
        r"\bhostel\b", r"\blodge\b",
    ],
    "Food & Dining": [
        r"\brestaurant\b", r"\bdining\b", r"\beating\s*out\b",
        r"\bswiggy\b", r"\bzomato\b",
        r"\bcafe\b", r"\bcoffee\b", r"\btea\b",
        r"\bsnack\b", r"\blunch\b", r"\bdinner\b", r"\bbreakfast\b",
        r"\bbiryani\b", r"\bpizza\b", r"\bburger\b",
        r"\bdominos\b", r"\bmcdonalds\b", r"\bkfc\b", r"\bstarbucks\b",
        r"\bjuice\b", r"\bcanteen\b", r"\bmess\b", r"\btiffin\b",
        r"\bbakery\b", r"\beat\b.*out",
        r"\bcoconut\s*water\b", r"\bmilkshake\b", r"\bshake\b",
        r"\blassi\b", r"\bchaas\b", r"\bsmoothie\b",
        r"\bcold\s*drink\b", r"\bsoda\b",
        r"\bnimbu\s*pani\b", r"\blemonade\b",
        r"\bnoodles\b", r"\bpasta\b", r"\bchowmein\b",
        r"\bfried\s*rice\b", r"\bthali\b",
        r"\bdosa\b", r"\bidli\b", r"\bvada\b",
        r"\bsamosa\b", r"\bchaat\b", r"\bpani\s*puri\b", r"\bgupchup\b",
        r"\bbhaji\b", r"\bpakora\b", r"\bkachori\b",
        r"\bdessert\b", r"\bice\s*cream\b", r"\bicecream\b", r"\bkulfi\b",
        r"\bmaggi\b", r"\bmaggie\b",
        r"\bsandwich\b", r"\bpav\b",
        r"\bmithai\b", r"\bhalwa\b", r"\bgulab\s*jamun\b", r"\bjalebi\b",
        r"\bsweet\s*shop\b", r"\bpaneer\b.*dish",
        r"\bhotel\b.*food", r"\bdhaba\b",
        r"\bfood\s*court\b", r"\bfood\s*delivery\b",
    ],
    "Transport & Auto": [
        r"\bpetrol\b", r"\bdiesel\b", r"\bcng\b",
        r"\bfuel\b", r"\bgas\s*station\b", r"\bfilling\s*station\b",
        r"\bindian\s*oil\b", r"\biocl\b", r"\bbharat\s*petroleum\b",
        r"\bhp\b.*petrol", r"\breliance\b.*petrol",
        r"\bev\s*charg\b", r"\belectric\b.*vehicle.*charg",
        r"\bflight\b", r"\bairport\b", r"\bairline\b",
        r"\btrain\b", r"\birctc\b", r"\brailway\b",
        r"\bbus\b.*ticket", r"\bbus\b.*fare",
        r"\bcab\b", r"\buber\b", r"\bola\b", r"\brapido\b",
        r"\btaxi\b",
        r"\bauto\s*rickshaw\b", r"\brickshaw\b", r"\bauto\b.*fare",
        r"\bmetro\b.*fare", r"\bmetro\b.*card",
        r"\btoll\b", r"\bparking\b",
        r"\bcar\b.*service", r"\bbike\b.*service",
        r"\bvehicle\b.*service", r"\bvehicle\b.*repair",
        r"\bcar\b.*repair", r"\bbike\b.*repair",
        r"\btyre\b", r"\btire\b",
        r"\bvehicle\b.*insurance", r"\bcar\b.*insurance",
        r"\bbike\b.*insurance", r"\bfastag\b",
        r"\btravel\b",
    ],
    "Health & Medical": [
        r"\bmedical\b", r"\bhospital\b", r"\bdoctor\b",
        r"\bmedicine\b", r"\bpharmacy\b", r"\bchemist\b",
        r"\bclinic\b", r"\bprescription\b",
        r"\bdiagnostic\b", r"\blab\b.*test", r"\btest\b.*lab",
        r"\bblood\s*test\b", r"\burine\s*test\b",
        r"\bxray\b", r"\bx-ray\b", r"\bmri\b", r"\bct\s*scan\b", r"\bscan\b.*report",
        r"\bdentist\b", r"\bdental\b",
        r"\beye\b.*check", r"\bvision\b.*test", r"\boptician\b",
        r"\bapollo\b.*pharma", r"\bmedplus\b", r"\bnetmeds\b",
        r"\bhealth\s*checkup\b",
        r"\bhealth\s*insurance\b",
    ],
    "Education & Children": [
        r"\beducation\b", r"\bschool\b.*fee", r"\bfee\b.*school",
        r"\bcollege\b.*fee", r"\bfee\b.*college",
        r"\buniversity\b", r"\btuition\b", r"\bcoaching\b",
        r"\bbook\b.*school", r"\bschool\b.*book",
        r"\bstationery\b", r"\bnote\s*book\b", r"\bpencil\b",
        r"\bcourse\b", r"\btraining\b", r"\bexam\b.*fee",
        r"\budemy\b", r"\bcoursera\b", r"\bkhan\s*academy\b",
        r"\btoys\b", r"\bkids\b.*activity", r"\bsports\b.*fee",
        r"\bschool\b", r"\bkindergarten\b",
    ],
    "Spiritual & Social": [
        r"\btemple\b", r"\bmandir\b", r"\bpooja\b", r"\bpuja\b",
        r"\bdaan\b", r"\bbhog\b", r"\bprasad\b",
        r"\bcharity\b", r"\bdonation\b", r"\bngo\b",
        r"\bgift\b", r"\bshagun\b", r"\blifafa\b",
        r"\bwedding\b", r"\bshadi\b", r"\bfunction\b.*hall",
        r"\bfestival\b", r"\bdiwali\b", r"\bholi\b", r"\beid\b",
        r"\bnavratri\b", r"\bganesh\b", r"\bdurga\b.*puja",
        r"\bcelebration\b",
    ],
    "Personal & Lifestyle": [
        r"\bsalon\b", r"\bhaircut\b", r"\bbarbershop\b",
        r"\bbeauty\b", r"\bparlour\b", r"\bparlor\b", r"\bspa\b",
        r"\bgym\b", r"\bfitness\b", r"\byoga\b",
        r"\bcloth\b", r"\bshoes\b", r"\bfashion\b",
        r"\bmyntra\b", r"\bnykaa\b", r"\bclothes\b", r"\bwear\b.*buy",
        r"\bamazon\b", r"\bflipkart\b", r"\bmeesho\b", r"\bajio\b",
        r"\bonline\s*shopping\b", r"\bshopping\b",
        r"\bmovie\b", r"\bcinema\b", r"\bpvr\b", r"\binox\b",
        r"\bnetflix\b", r"\bhotstar\b", r"\bprime\b.*video",
        r"\bspotify\b", r"\byoutube\b.*premium",
        r"\bgame\b", r"\bgaming\b",
        r"\bsubscription\b",
        r"\bmobile\s*recharge\b", r"\brecharge\b.*mobile",
        r"\bjio\b.*recharge", r"\bairtel\b.*recharge",
        r"\bvi\b.*recharge", r"\bbsnl\b",
        r"\belectronic\b.*buy", r"\bgadget\b",
        r"\bjewel\b", r"\bgold\b.*buy",
    ],
    "Financial & Legal": [
        r"\binsurance\b", r"\blic\b", r"\bpremium\b.*policy",
        r"\bpolicy\b.*premium", r"\bterm\s*plan\b",
        r"\bincome\s*tax\b", r"\btds\b", r"\btax\s*payment\b",
        r"\badvance\s*tax\b",
        r"\blegal\b", r"\blawyer\b", r"\badvocate\b",
        r"\bcourt\b.*fee", r"\bstamp\s*duty\b", r"\bnotary\b",
        r"\bregistration\s*fee\b", r"\bsub\s*registrar\b",
        r"\bcommission\b", r"\bbrokerage\b",
        r"\bbank\s*charge\b", r"\bpenalt\b.*bank",
        r"\bprocessing\s*fee\b", r"\bneft\b.*charge",
    ],
}

# Compiled patterns — list of (category, compiled_regex)
_COMPILED_RULES: list = []
for _cat, _patterns in CATEGORY_RULES.items():
    for _pat in _patterns:
        _COMPILED_RULES.append((_cat, re.compile(_pat, re.IGNORECASE)))


def suggest_category(description: Optional[str]) -> Optional[str]:
    """
    Given an expense description, return the best-matching category name.
    Returns None if no match is found.
    """
    if not description or not description.strip():
        return None

    text = description.strip()
    scores: dict[str, int] = {}
    for cat, regex in _COMPILED_RULES:
        if regex.search(text):
            scores[cat] = scores.get(cat, 0) + 1

    if not scores:
        return None

    return max(scores, key=scores.get)


def suggest_categories_bulk(descriptions: list[str]) -> list[Optional[str]]:
    """Batch categorization for multiple descriptions."""
    return [suggest_category(d) for d in descriptions]


# ─────────────────────────────────────────────────────────────────────────────
# Sub-category rules aligned with DB seed (migration 017_categories)
# ─────────────────────────────────────────────────────────────────────────────
SUBCATEGORY_RULES: dict[str, dict[str, list[str]]] = {
    "Groceries & Daily Needs": {
        "Vegetables & Fruits":            [r"\bvegetables?\b", r"\bsabzi\b", r"\bfruits?\b"],
        "Dairy & Eggs":                    [r"\bmilk\b", r"\bdairy\b", r"\beggs?\b", r"\bcurd\b", r"\byogurt\b"],
        "Grains & Staples":                [r"\brice\b", r"\batta\b", r"\bdal\b", r"\bflour\b", r"\bgrains?\b"],
        "Spices & Condiments":             [r"\bspice\b", r"\bmasala\b", r"\bsauce\b", r"\bpickle\b"],
        "Grocery Apps (BigBasket, Blinkit)":[r"\bbigbasket\b", r"\binstamart\b", r"\bzepto\b", r"\bblinkit\b", r"\bdmart\b"],
        "Household Supplies":              [r"\bdetergent\b", r"\bsabun\b", r"\btissue\b", r"\bcleaning\b.*supply", r"\bhousehold\b.*supply"],
    },
    "Housing & Utilities": {
        "Rent / EMI":                  [r"\brent\b", r"\bemi\b", r"\bhome\s*loan\b"],
        "Electricity":                 [r"\belectricity\b", r"\belectric\s*bill\b"],
        "Water":                       [r"\bwater\s*bill\b"],
        "Gas (Piped / Cylinder)":      [r"\bgas\s*bill\b", r"\bcylinder\b", r"\blpg\b"],
        "Internet & Phone":            [r"\bwifi\b", r"\binternet\b", r"\bbroadband\b", r"\bairtel\b.*fiber", r"\bjio\b.*fiber"],
        "DTH / Cable":                 [r"\bdth\b", r"\bcable\s*tv\b", r"\bdish\s*tv\b", r"\btata\s*sky\b"],
        "Society Maintenance":         [r"\bsociety\b", r"\bmaintenance\s*charge\b"],
        "Home Repair & Painting":      [r"\brepair\b", r"\bpainting\b", r"\brenovation\b", r"\bplumber\b", r"\belectrician\b", r"\bcarpenter\b"],
    },
    "Food & Dining": {
        "Restaurant / Eating Out":             [r"\brestaurant\b", r"\bdining\b", r"\bthali\b", r"\bdhaba\b", r"\beating\s*out\b"],
        "Food Delivery (Swiggy, Zomato)":      [r"\bswiggy\b", r"\bzomato\b", r"\bdelivery\b.*food", r"\bfood\b.*delivery"],
        "Snacks & Chai / Coffee":              [r"\bsnack\b", r"\bcoffee\b", r"\btea\b", r"\bcafe\b", r"\bjuice\b",
                                               r"\bcoconut\b", r"\bmilkshake\b", r"\blassi\b", r"\bchaas\b",
                                               r"\blemonade\b", r"\bsamosa\b", r"\bchaat\b", r"\bpani\s*puri\b",
                                               r"\bbhaji\b", r"\bpakora\b", r"\bice\s*cream\b", r"\bkulfi\b",
                                               r"\bsandwich\b", r"\bbakery\b", r"\bjalebi\b", r"\bkachori\b"],
        "Mess / Tiffin Service":               [r"\bmess\b", r"\btiffin\b", r"\bcanteen\b"],
        "Sweet Shop / Mithai":                 [r"\bmithai\b", r"\bhalwa\b", r"\bgulab\s*jamun\b", r"\bsweet\s*shop\b"],
    },
    "Education & Children": {
        "School / College Fees": [r"\bfee\b", r"\btuition\b", r"\bschool\b", r"\bcollege\b"],
        "Books & Stationery":    [r"\bbook\b", r"\bstationery\b", r"\bnote\s*book\b", r"\bpencil\b"],
        "Coaching / Tuition":    [r"\bcoaching\b", r"\btuition\b", r"\btraining\b"],
        "Online Courses":        [r"\budemy\b", r"\bcoursera\b", r"\bcourse\b", r"\bonline\b.*learn"],
        "Kids Activities / Sports": [r"\btoys\b", r"\bkids\b.*activity", r"\bsports\b.*fee"],
    },
    "Transport & Auto": {
        "Petrol / Diesel / CNG": [r"\bpetrol\b", r"\bdiesel\b", r"\bcng\b", r"\bfuel\b",
                                  r"\bgas\s*station\b", r"\bfilling\s*station\b",
                                  r"\bindian\s*oil\b", r"\biocl\b", r"\bbharat\s*petroleum\b",
                                  r"\bev\s*charg\b"],
        "Auto / Rickshaw":        [r"\bauto\s*rickshaw\b", r"\brickshaw\b", r"\bauto\b.*fare"],
        "Cab (Ola, Uber)":        [r"\bcab\b", r"\buber\b", r"\bola\b", r"\brapido\b", r"\btaxi\b"],
        "Vehicle Service / Repair": [r"\bcar\b.*service", r"\bbike\b.*service",
                                     r"\bvehicle\b.*service", r"\brepair\b.*car",
                                     r"\btyre\b", r"\btire\b"],
        "Toll & Parking":         [r"\btoll\b", r"\bparking\b", r"\bfastag\b"],
        "Vehicle Insurance / Tax":[r"\bvehicle\b.*insurance", r"\bcar\b.*insurance", r"\bbike\b.*insurance"],
    },
    "Health & Medical": {
        "Doctor / Hospital":        [r"\bhospital\b", r"\bdoctor\b", r"\bclinic\b", r"\bsurgery\b", r"\bconsultation\b"],
        "Medicine / Pharmacy":      [r"\bmedicine\b", r"\bpharmacy\b", r"\bchemist\b", r"\bprescription\b", r"\bmedplus\b", r"\bnetmeds\b"],
        "Diagnostic / Lab Tests":   [r"\blab\b", r"\btest\b.*report", r"\bdiagnostic\b", r"\bxray\b", r"\bmri\b", r"\bblood\s*test\b"],
        "Health Insurance Premium": [r"\bhealth\s*insurance\b"],
        "Dental / Eye Care":        [r"\bdentist\b", r"\bdental\b", r"\beye\b.*check", r"\boptician\b"],
    },
    "Spiritual & Social": {
        "Temple / Pooja / Daan":      [r"\btemple\b", r"\bmandir\b", r"\bpooja\b", r"\bpuja\b", r"\bdaan\b", r"\bprasad\b"],
        "Festivals & Celebrations":   [r"\bfestival\b", r"\bdiwali\b", r"\bholi\b", r"\beid\b", r"\bnavratri\b", r"\bganesh\b", r"\bcelebration\b"],
        "Gifts & Shagun":             [r"\bgift\b", r"\bshagun\b", r"\blifafa\b"],
        "Wedding / Function":         [r"\bwedding\b", r"\bshadi\b", r"\bfunction\b.*hall"],
        "Charity / Donation":         [r"\bcharity\b", r"\bdonation\b", r"\bngo\b"],
    },
    "Personal & Lifestyle": {
        "Clothing & Fashion":     [r"\bcloth\b", r"\bshoes\b", r"\bfashion\b", r"\bmyntra\b", r"\bclothes\b", r"\bwear\b.*buy", r"\bkurta\b", r"\bjeans\b"],
        "Salon & Grooming":       [r"\bsalon\b", r"\bhaircut\b", r"\bbarbershop\b", r"\bbeauty\b", r"\bparlour\b", r"\bparlor\b", r"\bspa\b", r"\bnykaa\b"],
        "Online Shopping":        [r"\bamazon\b", r"\bflipkart\b", r"\bmeesho\b", r"\bajio\b", r"\bonline\s*shopping\b"],
        "Entertainment & Movies": [r"\bmovie\b", r"\bcinema\b", r"\bpvr\b", r"\binox\b",
                                   r"\bnetflix\b", r"\bhotstar\b", r"\bprime\b.*video",
                                   r"\bspotify\b", r"\byoutube\b.*premium",
                                   r"\bgame\b", r"\bsubscription\b"],
        "Gym / Fitness":          [r"\bgym\b", r"\bfitness\b", r"\byoga\b", r"\bworkout\b"],
        "Mobile Recharge / Apps": [r"\bmobile\s*recharge\b", r"\brecharge\b", r"\bjio\b.*recharge",
                                   r"\bairtel\b.*recharge", r"\bvi\b.*recharge"],
    },
    "Financial & Legal": {
        "Insurance Premium (LIC etc)": [r"\blic\b", r"\binsurance\b.*premium", r"\bpremium\b.*policy", r"\bterm\s*plan\b"],
        "Income Tax / TDS":            [r"\bincome\s*tax\b", r"\btds\b", r"\btax\s*payment\b", r"\badvance\s*tax\b"],
        "Legal / Stamp Duty":          [r"\blegal\b", r"\blawyer\b", r"\badvocate\b", r"\bstamp\s*duty\b", r"\bnotary\b"],
        "Bank Charges / Penalties":    [r"\bbank\s*charge\b", r"\bpenalt\b", r"\bprocessing\s*fee\b"],
        "Commission / Brokerage":      [r"\bcommission\b", r"\bbrokerage\b", r"\bdalali\b"],
    },
}

# Compiled subcategory rules: category → list of (subcategory, compiled_regex)
_COMPILED_SUBCATEGORY_RULES: dict[str, list] = {}
for _cat, _submap in SUBCATEGORY_RULES.items():
    _COMPILED_SUBCATEGORY_RULES[_cat] = []
    for _sub, _patterns in _submap.items():
        for _pat in _patterns:
            _COMPILED_SUBCATEGORY_RULES[_cat].append(
                (_sub, re.compile(_pat, re.IGNORECASE))
            )


def suggest_subcategory(category: Optional[str], description: Optional[str]) -> Optional[str]:
    """
    Given a category and description, return the best-matching sub-category.
    Returns None if no match or no rules for the category.
    """
    if not category or not description or not description.strip():
        return None

    rules = _COMPILED_SUBCATEGORY_RULES.get(category)
    if not rules:
        return None

    text = description.strip()
    scores: dict[str, int] = {}
    for sub, regex in rules:
        if regex.search(text):
            scores[sub] = scores.get(sub, 0) + 1

    if not scores:
        return None

    return max(scores, key=scores.get)
