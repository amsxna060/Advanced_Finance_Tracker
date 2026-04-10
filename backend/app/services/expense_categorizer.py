"""
Smart expense categorization service.

Uses keyword / pattern matching to suggest expense categories from descriptions.
No external API calls needed — works offline, zero cost, zero latency.

Ordered by specificity: more specific patterns checked first.
"""

import re
from typing import Optional

# Category → list of keyword patterns (case-insensitive)
# Patterns are checked in order; first match wins.
CATEGORY_RULES = {
    "Grocery": [
        r"\bgrocery\b", r"\bgrocer\b", r"\bvegetable\b", r"\bsabzi\b",
        r"\bfruit\b", r"\bration\b", r"\bkirana\b", r"\bdmart\b",
        r"\bbigbasket\b", r"\bzepto\b", r"\bblinkit\b", r"\binstamart\b",
        r"\bmilk\b", r"\bdairy\b", r"\bbread\b", r"\batta\b", r"\brice\b",
        r"\bdal\b", r"\boil\b", r"\bsugar\b", r"\bspice\b", r"\bflour\b",
    ],
    "Food & Dining": [
        r"\brestaurant\b", r"\bhotel\b", r"\bswiggy\b", r"\bzomato\b",
        r"\bfood\b", r"\bdining\b", r"\bcafe\b", r"\bcoffee\b",
        r"\btea\b", r"\bsnack\b", r"\blunch\b", r"\bdinner\b",
        r"\bbreakfast\b", r"\bbiryani\b", r"\bpizza\b", r"\bburger\b",
        r"\bdominos\b", r"\bmcdonalds\b", r"\bkfc\b", r"\bstarbucks\b",
        r"\bjuice\b", r"\bcanteen\b", r"\bmess\b", r"\btiffin\b",
        r"\bbakery\b", r"\beat\b",
        # Beverages
        r"\bcoconut\b", r"\bmilkshake\b", r"\bshake\b", r"\blassi\b",
        r"\bchaas\b", r"\bsmoothie\b", r"\bbeverage\b", r"\bdrink\b",
        r"\bsoda\b", r"\bcold\s*drink\b", r"\bsherbet\b", r"\bsharbat\b",
        # Indian & common food items
        r"\bnimbu\s*pani\b", r"\blemonade\b",
        r"\bnoodles\b", r"\bpasta\b", r"\bchowmein\b", r"\bfried\s*rice\b",
        r"\bthali\b", r"\bdosa\b", r"\bidli\b", r"\bvada\b", r"\bpav\b",
        r"\bsamosa\b", r"\bchaat\b", r"\bpani\s*puri\b", r"\bgupchup\b",
        r"\bbhaji\b", r"\bpaneer\b", r"\bchicken\b", r"\bmutton\b",
        r"\bsandwich\b", r"\bdessert\b", r"\bice\s*cream\b", r"\bicecream\b",
        r"\bkulfi\b", r"\bmaggi\b", r"\bmaggie\b", r"\binstant\s*noodles\b",
        r"\broti\b", r"\bparatha\b", r"\bnaan\b", r"\bchapati\b",
        r"\bsweet\s*shop\b", r"\bmithai\b", r"\bhalwa\b", r"\bgulab\s*jamun\b",
        r"\bpakora\b", r"\bkachori\b", r"\bjalebi\b",
    ],
    "Fuel": [
        r"\bfuel\b", r"\bpetrol\b", r"\bdiesel\b", r"\bcng\b",
        r"\bgas\s*station\b", r"\bpump\b", r"\bhp\b.*petrol",
        r"\bindian\s*oil\b", r"\bbharat\s*petroleum\b", r"\biocl\b",
        r"\bev\s*charg\b", r"\brecharge.*vehicle\b",
    ],
    "Travel": [
        r"\btravel\b", r"\bflight\b", r"\btrain\b", r"\bbus\b",
        r"\bcab\b", r"\buber\b", r"\bola\b", r"\brapido\b",
        r"\btaxi\b", r"\bairport\b", r"\brailway\b", r"\birctc\b",
        r"\bticket\b", r"\bboarding\b", r"\bfare\b", r"\btoll\b",
        r"\bparking\b", r"\bauto\b.*rickshaw\b", r"\brickshaw\b",
        r"\bmetro\b",
    ],
    "Medical": [
        r"\bmedical\b", r"\bhospital\b", r"\bdoctor\b", r"\bmedicine\b",
        r"\bpharmacy\b", r"\bclinic\b", r"\blab\b.*test", r"\btest\b.*lab",
        r"\bhealth\b", r"\bprescription\b", r"\bsurgery\b",
        r"\bdiagnostic\b", r"\bdentist\b", r"\beye\b.*check",
        r"\bxray\b", r"\bx-ray\b", r"\bscan\b", r"\bmri\b",
        r"\bblood\s*test\b", r"\bchemist\b", r"\bapollo\b",
    ],
    "Education": [
        r"\beducation\b", r"\bschool\b", r"\bcollege\b",
        r"\buniversity\b", r"\btuition\b", r"\bcoaching\b",
        r"\bbook\b", r"\bstationery\b", r"\bcourse\b",
        r"\btraining\b", r"\bexam\b", r"\bfee\b.*school",
        r"\bschool\b.*fee", r"\budemy\b", r"\bcoursera\b",
    ],
    "Rent": [
        r"\brent\b", r"\bhouse\s*rent\b", r"\bflat\s*rent\b",
        r"\broom\s*rent\b", r"\bpg\b.*rent", r"\brent\b.*pg",
        r"\bhostel\b", r"\blodge\b", r"\bstay\b",
    ],
    "Utilities": [
        r"\belectricity\b", r"\bwater\b.*bill", r"\bbill\b.*water",
        r"\bgas\b.*bill", r"\bbill\b.*gas", r"\bwifi\b", r"\binternet\b",
        r"\bbroadband\b", r"\brecharge\b", r"\bmobile\b.*bill",
        r"\bphone\b.*bill", r"\bdth\b", r"\bcable\b",
        r"\bjio\b", r"\bairtel\b", r"\bvi\b.*recharge",
        r"\butility\b", r"\butilities\b",
    ],
    "Insurance": [
        r"\binsurance\b", r"\bpremium\b", r"\blic\b",
        r"\bhealth\s*insurance\b", r"\bcar\s*insurance\b",
        r"\blife\s*insurance\b", r"\bterm\s*plan\b",
        r"\bpolicy\b.*premium",
    ],
    "Shopping": [
        r"\bshopping\b", r"\bamazon\b", r"\bflipkart\b",
        r"\bmyntra\b", r"\bajio\b", r"\bmeesho\b", r"\bnykaa\b",
        r"\bcloth\b", r"\bshoes\b", r"\bfashion\b",
        r"\belectronic\b", r"\bgadget\b", r"\bmobile\b.*buy",
        r"\bphone\b.*buy", r"\blaptop\b", r"\bwatch\b",
        r"\bjewel\b", r"\bgold\b.*buy",
    ],
    "Entertainment": [
        r"\bmovie\b", r"\bcinema\b", r"\bnetflix\b", r"\bhotstar\b",
        r"\bprime\b.*video", r"\bspotify\b", r"\bgame\b",
        r"\bsubscription\b", r"\byoutube\b.*premium",
        r"\bentertainment\b", r"\bparty\b", r"\bevent\b",
        r"\bconcert\b", r"\bpark\b.*ticket",
    ],
    "Maintenance": [
        r"\bmaintenance\b", r"\brepair\b", r"\bservice\b.*car",
        r"\bcar\b.*service", r"\bbike\b.*service",
        r"\bplumber\b", r"\belectrician\b", r"\bcarpenter\b",
        r"\bpainting\b", r"\bfixing\b", r"\bac\s*service\b",
        r"\bwashing\s*machine\b", r"\bfridge\b",
    ],
    "Commission": [
        r"\bcommission\b", r"\bbrokerage\b", r"\bagent\b.*fee",
        r"\bmediator\b", r"\bdalali\b",
    ],
    "Legal": [
        r"\blegal\b", r"\blawyer\b", r"\badvocate\b",
        r"\bcourt\b", r"\bstamp\b.*paper", r"\bnotary\b",
        r"\bsolicitor\b",
    ],
    "Registration": [
        r"\bregistration\b", r"\bstamp\s*duty\b",
        r"\bproperty\b.*registration", r"\bsub\s*registrar\b",
        r"\btransfer\b.*deed",
    ],
    "Home": [
        r"\bhome\b", r"\bhouse\b.*expense", r"\bfurniture\b",
        r"\bappliance\b", r"\bkitchen\b", r"\bcleaning\b",
        r"\bhousehold\b", r"\bdomestic\b", r"\bservant\b",
        r"\bmaid\b", r"\bcook\b.*salary", r"\bwash\b",
    ],
    "Market": [
        r"\bmarket\b", r"\bbazaar\b",
    ],
    "Personal": [
        r"\bpersonal\b", r"\bsalon\b", r"\bhaircut\b",
        r"\bbarbershop\b", r"\bgym\b", r"\bfitness\b",
        r"\bspa\b", r"\bbeauty\b", r"\bparlour\b",
        r"\bparlor\b", r"\bclothes\b",
    ],
    "Business": [
        r"\bbusiness\b", r"\boffice\b", r"\bsalar\b",
        r"\bstationery\b.*office", r"\boffice\b.*supply",
        r"\bprinting\b", r"\bcourier\b",
    ],
}

# Compiled patterns — list of (category, compiled_regex)
_COMPILED_RULES = []
for cat, patterns in CATEGORY_RULES.items():
    for pat in patterns:
        _COMPILED_RULES.append((cat, re.compile(pat, re.IGNORECASE)))


def suggest_category(description: Optional[str]) -> Optional[str]:
    """
    Given an expense description, return the best-matching category name.
    Returns None if no match is found.
    """
    if not description or not description.strip():
        return None

    text = description.strip()

    # Score each category by number of matching patterns
    scores = {}
    for cat, regex in _COMPILED_RULES:
        if regex.search(text):
            scores[cat] = scores.get(cat, 0) + 1

    if not scores:
        return None

    # Return category with highest score
    return max(scores, key=scores.get)


def suggest_categories_bulk(descriptions: list[str]) -> list[Optional[str]]:
    """Batch categorization for multiple descriptions."""
    return [suggest_category(d) for d in descriptions]


# Subcategory rules per category: subcategory → list of keyword patterns
SUBCATEGORY_RULES: dict[str, dict[str, list[str]]] = {
    "Grocery": {
        "Vegetables & Fruits": [r"\bvegetable\b", r"\bsabzi\b", r"\bfruit\b"],
        "Dairy & Eggs":        [r"\bmilk\b", r"\bdairy\b", r"\begg\b", r"\bcurd\b", r"\byogurt\b"],
        "Grains & Staples":    [r"\brice\b", r"\batta\b", r"\bdal\b", r"\bflour\b", r"\bgrain\b"],
        "Grocery Apps":        [r"\bbigbasket\b", r"\binstamart\b", r"\bzepto\b", r"\bblinkit\b"],
    },
    "Food & Dining": {
        "Restaurant":      [r"\brestaurant\b", r"\bdining\b", r"\bthali\b", r"\bdosa\b",
                            r"\bidli\b", r"\bvada\b", r"\bpaneer\b", r"\bchicken\b",
                            r"\bmutton\b"],
        "Food Delivery":   [r"\bswiggy\b", r"\bzomato\b", r"\bdelivery\b.*food", r"\bfood\b.*delivery"],
        "Snacks & Coffee": [r"\bsnack\b", r"\bcoffee\b", r"\btea\b", r"\bcafe\b",
                            r"\bjuice\b", r"\bcoconut\b", r"\bmilkshake\b", r"\bshake\b",
                            r"\blassi\b", r"\bchaas\b", r"\bsmoothie\b", r"\bdrink\b",
                            r"\bsoda\b", r"\bcold\s*drink\b", r"\bnimbu\b", r"\blemonade\b",
                            r"\bsamosa\b", r"\bchaat\b", r"\bpani\s*puri\b", r"\bgupchup\b",
                            r"\bbhaji\b", r"\bpakora\b", r"\bkachori\b",
                            r"\bdessert\b", r"\bice\s*cream\b", r"\bicecream\b", r"\bkulfi\b",
                            r"\bmithai\b", r"\bhalwa\b", r"\bgulab\s*jamun\b", r"\bjalebi\b",
                            r"\bsandwich\b", r"\bbakery\b"],
        "Fast Food":       [r"\bdominos\b", r"\bmcdonalds\b", r"\bkfc\b", r"\bpizza\b", r"\bburger\b",
                            r"\bnoodles\b", r"\bpasta\b", r"\bchowmein\b", r"\bfried\s*rice\b",
                            r"\bmaggi\b", r"\bmaggie\b", r"\binstant\s*noodles\b",
                            r"\broti\b", r"\bparatha\b", r"\bnaan\b", r"\bpav\b"],
        "Mess / Tiffin":   [r"\bmess\b", r"\btiffin\b", r"\bcanteen\b"],
    },
    "Travel": {
        "Cab & Taxi":       [r"\bcab\b", r"\buber\b", r"\bola\b", r"\btaxi\b", r"\brapido\b"],
        "Air Travel":       [r"\bflight\b", r"\bairport\b", r"\bairline\b"],
        "Rail Travel":      [r"\btrain\b", r"\birctc\b", r"\brailway\b"],
        "Local Transport":  [r"\bbus\b", r"\bmetro\b", r"\bauto\b", r"\brickshaw\b"],
        "Toll & Parking":   [r"\btoll\b", r"\bparking\b"],
    },
    "Medical": {
        "Hospital":             [r"\bhospital\b", r"\bdoctor\b", r"\bclinic\b", r"\bsurgery\b"],
        "Medicine / Pharmacy":  [r"\bmedicine\b", r"\bpharmacy\b", r"\bchemist\b", r"\bprescription\b"],
        "Diagnostic":           [r"\blab\b", r"\btest\b", r"\bdiagnostic\b", r"\bxray\b", r"\bx-ray\b", r"\bmri\b", r"\bscan\b", r"\bblood\s*test\b"],
        "Dental":               [r"\bdentist\b", r"\bdental\b"],
    },
    "Education": {
        "School / College Fees": [r"\bfee\b", r"\btuition\b", r"\bschool\b", r"\bcollege\b"],
        "Books & Stationery":    [r"\bbook\b", r"\bstationery\b"],
        "Online Courses":        [r"\budemy\b", r"\bcoursera\b", r"\bcourse\b", r"\bonline\b"],
        "Coaching":              [r"\bcoaching\b", r"\btraining\b"],
    },
    "Utilities": {
        "Electricity":      [r"\belectricity\b"],
        "Internet & Phone": [r"\binternet\b", r"\bwifi\b", r"\bbroadband\b", r"\brecharge\b", r"\bairtel\b", r"\bjio\b", r"\bmobile\b.*bill"],
        "Gas":              [r"\bgas\b.*bill"],
        "Water":            [r"\bwater\b.*bill"],
        "DTH / Cable":      [r"\bdth\b", r"\bcable\b"],
    },
    "Shopping": {
        "Online Shopping":    [r"\bamazon\b", r"\bflipkart\b", r"\bmeesho\b", r"\bajio\b"],
        "Clothing & Fashion": [r"\bcloth\b", r"\bshoes\b", r"\bfashion\b", r"\bmyntra\b", r"\bnykaa\b"],
        "Electronics":        [r"\belectronic\b", r"\bgadget\b", r"\blaptop\b"],
        "Jewellery":          [r"\bjewel\b", r"\bgold\b"],
    },
    "Entertainment": {
        "Movies":    [r"\bmovie\b", r"\bcinema\b", r"\bpvr\b", r"\binox\b"],
        "Streaming": [r"\bnetflix\b", r"\bhotstar\b", r"\bprime\b.*video", r"\bspotify\b", r"\byoutube\b.*premium"],
        "Gaming":    [r"\bgame\b", r"\bgaming\b"],
        "Events":    [r"\bparty\b", r"\bevent\b", r"\bconcert\b"],
    },
    "Maintenance": {
        "Vehicle Service":    [r"\bcar\b.*service", r"\bbike\b.*service", r"\bservice\b.*car", r"\bservice\b.*bike"],
        "Home Repair":        [r"\brepair\b", r"\bplumber\b", r"\belectrician\b", r"\bcarpenter\b"],
        "Appliance":          [r"\bac\b.*service", r"\bac\b.*repair", r"\bwashing\s*machine\b", r"\bfridge\b"],
        "Painting / Renovation": [r"\bpaint\b", r"\brenovation\b"],
    },
    "Personal": {
        "Salon & Grooming": [r"\bsalon\b", r"\bhaircut\b", r"\bbarbershop\b", r"\bbeauty\b", r"\bparlour\b", r"\bparlor\b", r"\bspa\b"],
        "Fitness":          [r"\bgym\b", r"\bfitness\b", r"\byoga\b", r"\bworkout\b"],
        "Clothing":         [r"\bclothes\b", r"\bwear\b"],
    },
    "Fuel": {
        "Petrol":      [r"\bpetrol\b"],
        "Diesel":      [r"\bdiesel\b"],
        "CNG":         [r"\bcng\b"],
        "EV Charging": [r"\bev\b.*charg", r"\belectric\b.*charg"],
    },
    "Home": {
        "Furniture":       [r"\bfurniture\b", r"\bsofa\b", r"\bchair\b", r"\btable\b"],
        "Appliances":      [r"\bappliance\b", r"\bkitchen\b.*appliance"],
        "Household Help":  [r"\bmaid\b", r"\bservant\b", r"\bcook\b.*salary"],
        "Cleaning":        [r"\bcleaning\b", r"\bwash\b"],
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
    Returns None if the category has no subcategory rules or no match is found.
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
